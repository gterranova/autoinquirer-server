import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import * as _ from "lodash";

import { AbstractDataSource } from 'autoinquirer/build/datasource';
import { IDispatchOptions, IProperty, Action } from 'autoinquirer/build/interfaces';
import { JsonDataSource, JsonSchema } from 'autoinquirer';
import { join } from 'path';

class AuthError extends Error {
  constructor(errors: string[]) {
    super();
    this.errors = errors.map( e => { return { message: e } });
    this.message = this.errors.toString();
    this.ajv = true;
  }
  errors: any[];
  ajv: boolean;
}

export class AuthDataSource extends AbstractDataSource {
  private dataSource: AbstractDataSource;
  private schemaSource: JsonSchema;

  constructor(data: string | AbstractDataSource) {
      super();
      this.dataSource = (typeof data === 'string') ? new JsonDataSource(data) : data;
      this.schemaSource = new JsonSchema(join(__dirname, 'usersSchema.json'));
  }

  public async connect(): Promise<void> {
    await this.dataSource.connect();
    await this.schemaSource.connect();
  }
  public async close(): Promise<void> {
    await this.dataSource.close();
  }

  public async isMethodAllowed(methodName, options): Promise<Boolean> {
    return true;
  }

  public getSchemaDataSource(_parentDataSource?: AbstractDataSource) {
    return this.schemaSource;
  }

  public getDataSource(_parentDispatcher?: AbstractDataSource): AbstractDataSource {
    return this;
  }

  private getRequestInfo(options: IDispatchOptions) {
    const levels = options.itemPath.split('/');
    const action = levels.shift();
    return { 
      action, 
      userId: levels.length > 0 && action === 'users' && levels[0], 
      userProp: levels.length > 1  && action === 'users' && levels[1]
    };
  }

  // tslint:disable-next-line:no-reserved-keywords
  public async getSchema(options?: IDispatchOptions): Promise<IProperty> {
    const { parentPath, itemPath} = options;
    const newPath = [parentPath, itemPath].filter( p => p?.length).join('/');
    return await this.getDataSource().get({ itemPath: newPath });
  }

  public async get(options?: IDispatchOptions): Promise<any> {
    return await this.dataSource.dispatch('get', options);
  }
  
  public async dispatch(methodName: string, options?: IDispatchOptions) {
    options = options || {};

    options.itemPath = options?.itemPath ? await this.convertPathToUri(options?.itemPath) : '';
    options.schema = options?.schema || await this.getSchema(options);
    options.value = options?.value;

    const info = this.getRequestInfo(options);
    if (options.user && info.action === 'me') {
      return options.user;
    }

    if (options.value && info.action === 'register') {
      const { email, password } = options.value;
      let user = (await this.dataSource.get({ itemPath: 'users' } )).find(u => u.email === email);
      if (user) throw new AuthError([`Email '${email}' is already taken`]);
      user = await this.dataSource.dispatch(Action.PUSH, { itemPath: 'users', value: { email, password: bcrypt.hashSync(password, 5), active: false, code: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) }} );
      if (user) {
        const token = jwt.sign({ uid: user._id }, 'secret', { expiresIn: 30 });
        return ({
          uid: user._id,
          token
        });
      }
      throw new AuthError(['Registration failed']);
    }

    if (options.value && info.action === 'login') {
      const user = (await this.dataSource.get({ itemPath: 'users' } )).find(
        u =>
          u.email === options.value.email &&
          bcrypt.compareSync(options.value.password, u.password)
      );
      if (user) {
        if (!user.active) {
          throw new AuthError(['You must first activate the account.']);    
        }
        const token = jwt.sign({ uid: user._id }, 'secret', { expiresIn: 30 });
        return ({
          uid: user._id,
          token
        });
      }
      throw new AuthError(['Login failed']);
    }

    if ((options.value || options.query?.code) && info.action === 'activate') {
      const { code } = (options.value || options.query);
      const isDirectLink = !!(options.query?.code);
      if (!code) {
        if (!isDirectLink) throw new AuthError(['No code provided']);
        return { code: '', error: 'No code provided' };
      }
      let user = (await this.dataSource.get({ itemPath: 'users' } )).find(u => u.code === code);
      if (!user) {
        if (!isDirectLink) throw new AuthError(['Activation code is not valid']);
        return { code, error: 'Activation code is not valid' };
      }
      user = { ...user, active: true, code: undefined };
      await this.dataSource.dispatch(Action.SET, { itemPath: `users/${user._id}`, value: user } );
      return { code };
    }

    if (options.value && info.action === 'renew') {
      if (options.value.token) {
        const token = await jwt.verify(options.value.token, 'secret', (err, decoded) => {
          if (err) {
            //Here I can check if the received token in the request expired
            if(err.name == "TokenExpiredError" && decoded){
                var refreshedToken = jwt.sign({ uid: decoded.uid }, 'secret', { expiresIn: 30 });
                return ({ token: refreshedToken });
              } else if (err) {
                return { message: 'Failed to authenticate token.' };
              }         
          } else {
            //If no error with the token, continue 
            var refreshedToken = jwt.sign({ uid: decoded.uid }, 'secret', { expiresIn: 30 });
            return { token: refreshedToken };
          };          
        });
        return token;
      } else {
        throw new AuthError(['Failed to renew token']);
      }
    }

    return await this.dataSource.dispatch(methodName, options);
  }
}
