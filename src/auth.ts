import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import * as _ from "lodash";

import { AbstractDataSource } from 'autoinquirer/build/datasource';
import { IDispatchOptions, IProperty, Action } from 'autoinquirer/build/interfaces';
import { JsonDataSource } from 'autoinquirer';
import { access } from 'fs';

export interface UserElement {
  _id?: string;
  name: string;
  password: string;
};

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

  constructor(data: string | AbstractDataSource) {
      super();
      this.dataSource = (typeof data === 'string') ? new JsonDataSource(data) : data;
  }

  public async connect(): Promise<void> {
    await this.dataSource.connect();
  }
  public async close(): Promise<void> {
    await this.dataSource.close();
  }

  public async isMethodAllowed(methodName, options): Promise<Boolean> {
    return true;
  }

  public getSchemaDataSource(_parentDataSource?: AbstractDataSource) {
    return { ...this, get: (options) => this.getSchema(options) };
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

  public async getSchema(options?: IDispatchOptions): Promise<IProperty> {
    //console.log(`FILESYSTEM getSchema(itemPath: ${itemPath} ... parentPath?: ${parentPath}, params?: ${params})`);
    const userSchema = {
      type:"object", $title: "{{name}}",
      properties:{
        name:{ type: "string", title:"Name"},
        password:{ type: "string", title:"Password"}
      },
      required: ['name', 'password']
    };
    const register = {
      type:"object", $title: "{{name}}",
      writeOnly: true,
      properties:{ ...userSchema.properties,
        password2:{ type: "string", title:"Confirm Password"}
      },
      required: [...userSchema.required, 'password2']
    };
    const login = {...userSchema,  writeOnly: true, $widget: { componentType: 'auth', wrappers: [''], hideLabel: true }};
    const logout = { type: "boolean", title: "Logout" };
    const me = { ...userSchema, 
      properties: Object.keys(userSchema.properties).filter(p => p != 'password').reduce( (acc, v) => {acc[v] = userSchema.properties[v]; return acc;}, {}),
      readOnly: true };
    const users = { type: "array", title: "Users", items: me };
    //const createToken = userSchema;
    const tokenRenew = { type: "object", title: "Renew", properties: { token: { type: "string" }}};
    const schema = { type: "object", title: "Auth", properties: { users, register, login, logout, tokenRenew }, readOnly: true };
    const info = this.getRequestInfo(options);
    switch (info.action) {
      case 'users':
        if (info.userProp) {
          return me.properties[info.userProp];
        } else if (info.userId) {
            return {...me, readOnly: undefined};
        }
        return users;
      case 'register':
          return register;  
      case 'login':
          return login;  
      case 'renew':
          return tokenRenew;
      case 'logout':
        return logout;    
      case 'me':
        return me;
    }
    return schema;
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
      const { name, password } = options.value;
      const user = (await this.dataSource.get({ itemPath: 'users' } )).find(u => u.name === name);
      if (user) throw new AuthError([`Name '${name}' is already taken`]);
      return await this.dataSource.dispatch(Action.PUSH, { itemPath: 'users', value: { name, password: bcrypt.hashSync(password, 5) }} );
    }

    if (options.value && info.action === 'login') {
      const user = (await this.dataSource.get({ itemPath: 'users' } )).find(
        u =>
          u.name === options.value.name &&
          bcrypt.compareSync(options.value.password, u.password)
      );
      if (user) {
        const token = jwt.sign({ uid: user._id }, 'secret', { expiresIn: 30 });
        return ({
          uid: user._id,
          token
        });
      }
      throw new AuthError(['User does not exist']);
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
