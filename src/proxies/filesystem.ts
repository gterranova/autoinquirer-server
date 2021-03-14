import * as fs from "fs";
//import * as del from "delete";
import * as crypto from 'crypto';
import * as _ from "lodash";
import { join } from 'path';

import { AbstractDispatcher } from 'autoinquirer';
import { Action, IDispatchOptions, IProperty } from 'autoinquirer';
import { AutoinquirerGet, AutoinquirerPush, AutoinquirerUpdate, AutoinquirerSet, AutoinquirerDelete } from 'autoinquirer';

import { JsonSchema } from 'autoinquirer';
import * as filesystemSchema from './filesystemSchema.json';
import { absolute } from '../transformers/common';


function hash(key) {
  return crypto.pbkdf2Sync('secret', JSON.stringify(key), 100, 12, 'sha1').toString('hex');  // '3745e48...08d59ae'
}

export interface FileElement {
  _id?: string;
  isFolder: boolean;
  name: string;
  slug: string;
  dir: string;
  resourceUrl?: string;
};

interface IPathInfo {
  fullPath?: string,
  folder?: string,
  filename?: string, 
  property?: string
}

export class FileSystemDataSource extends AbstractDispatcher implements AutoinquirerGet, AutoinquirerPush, AutoinquirerUpdate, AutoinquirerSet, AutoinquirerDelete {
  rootDir: string;
  rootUrl: string;
  private schemaSource: JsonSchema;

  constructor(rootDir: string, rootUrl: string) {
    super();
    //console.log("constructor", parentDispatcher, rootDir);
    this.rootDir = rootDir || process.cwd();
    this.rootUrl = rootUrl || '';
    // JSONSCHEMA data relative to package dir
    this.schemaSource = new JsonSchema(filesystemSchema);
  }
  public async connect(parentDispatcher: AbstractDispatcher) {
    await this.schemaSource.connect(this);
    this.setParent(parentDispatcher);
   };
  public async close() { };

  public async isMethodAllowed(methodName, options): Promise<Boolean> {
    return true;
  }

  getDataSource() {
    return this;
  }
  
  getSchemaDataSource() {
    return { ...this, get: (options) => this.getSchema(options) };
  }

  private getPathInfo(options?: IDispatchOptions) : IPathInfo {
    const fullPath = _.compact([
      ...this.rootDir.split(RegExp('\\|\/')), 
      ...(options?.params?.rootDir || '').split(RegExp('\\|\/')), 
      ...options?.itemPath?.replace(RegExp(`^${options?.parentPath}[\\/|\\\\]?`), '').split(RegExp('\\|\/')) 
    ]).join('/');
    //console.log( "getPathInfo", { fullPath, resolveTo: resolve(fullPath), options });
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

  private getFiles(pathInfo: IPathInfo, depth = 1, relativePath = null) : FileElement[] {
    const { fullPath, folder, filename } = pathInfo;
    const prefix = this.rootUrl;
    if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
      return _.chain(fs.readdirSync(fullPath, { withFileTypes: true }))
        .map((element) => {
          const resourceUrl = !element.isDirectory()? 
            encodeURI(absolute([folder, element.name].join('/'), this.rootUrl).replace(RegExp('^'+prefix), '')) : 
            undefined;
          const item = {
            name: `${element.isDirectory()?'[ ':''}${element.name}${element.isDirectory()?' ]':''}`,
            slug: _.compact([relativePath, element.name]).join('/'),
            dir: [folder, element.name].join('/'),
            isFolder: element.isDirectory(),
            resourceUrl
          };
          if (depth > 1 && element.isDirectory()) {
            return [item, ...this.getFiles({ 
              fullPath: [fullPath, element.name].join('/'), 
              folder: [folder, element.name].join('/')}, depth-1, _.compact([relativePath, element.name]).join('/'))]
          }
          return [item];
      })
      .flattenDeep()
      .sortBy([o => !o.isFolder, 'name'])
      .value();
    } else {
      const resourceUrl = encodeURI(absolute([folder, filename].join('/'), this.rootUrl).replace(RegExp('^'+prefix), ''));
      return [{
        name: filename,
        slug: filename,
        dir: folder,
        isFolder: false,
        resourceUrl
      }]
    }
  }  

  public async getSchema(options?: IDispatchOptions): Promise<IProperty> {
    const { folder, filename, property } = this.getPathInfo(options);

    //console.log(await this.schemaSource.get({ itemPath: [filename && '#', property].filter(e => !!e).join('/') }));
    return this.schemaSource.get({ itemPath: [filename && '#', property].filter(e => !!e).join('/') });
  }

  public async get(options: IDispatchOptions): Promise<FileElement[]|FileElement> {
    //console.log(`FILESYSTEM get(itemPath: ${options.itemPath}, schema: ${JSON.stringify(options.schema)}, value: ${options.value}, parentPath: ${options.parentPath}, params: ${JSON.stringify(options.params)})`)
    const { fullPath, folder, filename, property } = this.getPathInfo(options);
    const depth = options.params?.depth || options.query?.depth;
    const files = this.getFiles({ fullPath, folder, filename, property }, depth);
    //console.log(`FILES = "${JSON.stringify(files, null, 2)}"`)
    if (filename) {
        if (property) {
          return files[0][property];
        }
        return files[0];
    }
    return files;
  };

  public async push(options?: IDispatchOptions) {
    //console.log(`FILESYSTEM push(itemPath: ${options.itemPath}, value: ${options.value}, parentPath: ${options.parentPath}, params: ${options.params})`)
    const { folder } = this.getPathInfo(options);
    //console.log(options.files);
    const files = _.isArray(options.files.file)? options.files.file: [options.files.file];
    await Promise.all(files.map( f => new Promise((resolve, reject) => {
        var source = fs.createReadStream(f.path);
        var dest = fs.createWriteStream(join(folder,f.name));
      
        source.pipe(dest);
        source.on('end', function() { 
          //console.log(`copied ${f.path} to ${join(folder,f.name)}`); 
          fs.unlinkSync(f.path);
          resolve(null);
        });
        source.on('error', function(err) { console.log(`error copying ${f.path} to ${join(folder,f.name)}`); reject(err); });      
      }))
    );
    return /* this.get(options) */[];
  }

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

  public async delete(options?: IDispatchOptions) {
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
  
  public async dispatch(methodName: Action, options?: IDispatchOptions): Promise<any> {
    //console.log(`FILESYSTEM dispatch(methodName: ${methodName},`, { options })
    options = options || {};
    //options.itemPath = options?.itemPath ? await this.convertPathToUri(options?.itemPath) : '';
    //options.schema = options?.schema || await this.getSchema(options);

    if (!this[methodName]) {
      throw new Error(`Method ${methodName} not implemented`);
    }

    // tslint:disable-next-line:no-return-await
    return await this[methodName].call(this, options);
  };

}
