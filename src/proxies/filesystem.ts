import * as fs from "fs";
//import * as del from "delete";
import * as crypto from 'crypto';
import * as _ from "lodash";

import { AbstractDataSource } from 'autoinquirer/build/datasource';
import { IDispatchOptions, IProperty } from 'autoinquirer/build/interfaces';
import { JsonSchema } from 'autoinquirer';
import { join } from 'path';


function hash(key) {
  return crypto.pbkdf2Sync('secret', JSON.stringify(key), 100, 12, 'sha1').toString('hex');  // '3745e48...08d59ae'
}

export interface FileElement {
  _id?: string;
  isFolder: boolean;
  name: string;
  slug: string;
  dir: string
};

interface IPathInfo {
  fullPath?: string,
  folder?: string,
  filename?: string, 
  property?: string
}

export class FileSystemDataSource extends AbstractDataSource {
  rootDir: string;
  private schemaSource: JsonSchema;

  constructor(rootDir?: string) {
    super();
    //console.log("constructor", rootDir);
    this.rootDir = rootDir || process.cwd();
    // JSONSCHEMA data relative to package dir
    this.schemaSource = new JsonSchema(join('.', 'src', 'proxies', 'filesystemSchema.json'));
  }
  public async connect() {
    await this.schemaSource.connect();
   };
  public async close() { };

  public async isMethodAllowed(methodName, options): Promise<Boolean> {
    return true;
  }

  getDataSource(_parentDataSource?: AbstractDataSource) {
    return this;
  }
  
  getSchemaDataSource(_parentDataSource?: AbstractDataSource) {
    return { ...this, get: (options) => this.getSchema(options) };
  }

  private getPathInfo(options?: IDispatchOptions) : IPathInfo {
    const fullPath = _.compact([
      ...this.rootDir.split(RegExp('\\|\/')), 
      ...(options?.params?.rootDir || '').split(RegExp('\\|\/')), 
      ...options?.itemPath?.replace(RegExp(`^${options?.parentPath}[\\/|\\\\]?`), '').split(RegExp('\\|\/')) 
    ]).join('/');
    
    if (!fullPath) return {};
    const pathParts = fullPath.split('/');
    let folder = '.', filename = '', properties = [], idx = 0;
    while (pathParts.length) {
      const testPath = pathParts.join('/');
      if (fs.existsSync(testPath)) {
        if ((fs.lstatSync(testPath).isDirectory())) {
          folder = testPath;
        } else {
          filename = pathParts.pop();
          folder = pathParts.join('/');
        }
        break;
      } else {
        properties.unshift(pathParts.pop());
      }
    }
    const property = properties.join('/')
    return { fullPath: fullPath.replace(RegExp(`\/?${property}$`), ''), folder, filename, property};  
  };

  private getFiles(pathInfo: IPathInfo) : FileElement[] {
    const { fullPath, folder, filename } = pathInfo;
    if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
      return _.sortBy(fs.readdirSync(fullPath, { withFileTypes: true }).map((element) => {
        return {
          name: `${element.isDirectory()?'[ ':''}${element.name}${element.isDirectory()?' ]':''}`,
          slug: element.name,
          dir: folder,
          isFolder: element.isDirectory()
        };
      }), [o => !o.isFolder, 'name']);
    } else {
      return [{
        name: filename,
        slug: filename,
        dir: folder,
        isFolder: false
      }]
    }
  }  

  public async getSchema(options?: IDispatchOptions): Promise<IProperty> {
    const { filename, property } = this.getPathInfo(options);

    //console.log(await this.schemaSource.get({ itemPath: [filename && '#', property].filter(e => !!e).join('/') }));
    return this.schemaSource.get({ itemPath: [filename && '#', property].filter(e => !!e).join('/') });
  }

  public async get(options: IDispatchOptions): Promise<FileElement[]|FileElement> {
    //console.log(`FILESYSTEM get(itemPath: ${itemPath}, schema: ${JSON.stringify(schema)}, value: ${value}, parentPath: ${parentPath}, params: ${JSON.stringify(params)})`)
    const { fullPath, folder, filename, property } = this.getPathInfo(options);
    const files = this.getFiles({ fullPath, folder, filename, property });
    //console.log(`FILES = "${JSON.stringify(files, null, 2)}"`)
    if (filename) {
        if (property) {
          return files[0][property];
        }
        return files[0];
    }
    return files;
  };

  public async set(options?: IDispatchOptions) {
    console.log(`FILESYSTEM set(itemPath: ${options.itemPath}, value: ${options.value}, parentPath: ${options.parentPath}, params: ${options.params})`)
  }

  public async update(options?: IDispatchOptions) {
    console.log(`FILESYSTEM update(itemPath: ${options.itemPath}, value: ${options.value}, parentPath: ${options.parentPath}, params: ${options.params})`)
    /*
    if (options?.value !== undefined) {
      if (options?.itemPath) {
        const files = [];
        const dir = join(this.rootDir, options?.params?.rootDir);
        for await (const f of getFiles(dir, options?.itemPath)) { files.push(f); };
        return files.map((f: FileElement) => {
          const currentPath = join(f.dir, f.name);
          const newPath = join(this.rootDir, options?.params?.rootDir, options?.value?.dir, options?.value?.name);
          if (currentPath !== newPath) {
            fs.renameSync(currentPath, newPath)
          }
        });
      }
      return options?.value;
    }
    */
  }

  public async del(options?: IDispatchOptions) {
    console.log(`FILESYSTEM del(itemPath: ${options?.itemPath}, schema: ${options?.schema}, value: ${options?.value}, parentPath: ${options?.parentPath}, params: ${options?.params})`)
    /*
    if (options?.itemPath) {
      const files = [];
      const dir = join(this.rootDir, options?.params?.rootDir);
      for await (const f of getFiles(dir, options?.itemPath)) { files.push(f); };
      //del(files.map((f: FileElement) => join(f.dir, f.name)));
    }
    */
  };
  
  public async dispatch(methodName: string, options?: IDispatchOptions): Promise<any> {
    //console.log(`FILESYSTEM dispatch(methodName: ${methodName}, itemPath: ${itemPath}, schema: ${schema}, value: ${value}, parentPath: ${parentPath}, params: ${JSON.stringify(params)})`)
    options = options || {};

    if (!this[methodName]) {
      throw new Error(`Method ${methodName} not implemented`);
    }

    // tslint:disable-next-line:no-return-await
    return await this[methodName].call(this, options);
  };

}
