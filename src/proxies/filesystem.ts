import * as fs from "fs";
import { basename, dirname } from 'path';
//import * as del from "delete";
import * as crypto from 'crypto';
import * as _ from "lodash";
import * as moment from 'moment';
import { join } from 'path';
import { lookup } from 'mime-types';

import { AbstractDispatcher } from 'autoinquirer';
import { Action, IDispatchOptions, IProperty } from 'autoinquirer';
import { AutoinquirerGet, AutoinquirerPush, AutoinquirerUpdate, AutoinquirerSet, AutoinquirerDelete } from 'autoinquirer';

import { JsonSchema } from 'autoinquirer';
import { absolute } from '../transformers/common';
import * as filesystemSchema from './filesystemSchema.json';
import * as iconsManifest from './iconsManifest.json';


function hash(key) {
  return crypto.pbkdf2Sync('secret', JSON.stringify(key), 100, 12, 'sha1').toString('hex');  // '3745e48...08d59ae'
}

function getLastModifiedAndSize(path: string): { mtime: Date; size: number; } {
  let mtime: Date = new Date(Date.now()), size = 0;
  try {
    const stats = fs.statSync(path);
    mtime = stats.mtime;
    size = stats.size;
  } catch (error) { }
  return { mtime, size };
}

function getMimeTypeAndIcon(path: string, prefix: string) {
  const mimetype = fs.existsSync(path) && !fs.lstatSync(path).isDirectory() ? lookup(path) || 'application/octet-stream' : 'folder/documents';
  const iconname = iconsManifest.Synonyms[mimetype.replace('/', '-')] || mimetype.replace('/', '-');
  const iconUrl = encodeURI(absolute(`./assets/mimetypes-icons/scalable/${iconname}.svg`, prefix).replace(RegExp('^' + prefix), ''));
  return { mimetype, iconUrl };
}

function getResourceUrl(path: string, prefix: string) {
  return { resourceUrl: fs.existsSync(path) && !fs.lstatSync(path).isDirectory() ?
      encodeURI(absolute(path, prefix).replace(RegExp('^'+prefix), '')) : null
  };
}

export interface FileElement {
  _id?: string;
  isFolder: boolean;
  title?: string;
  slug: string;
  path: string;
  lastModifiedDate: string;
  size: number;
  type: string;
  content?: string;
  resourceUrl?: string;
  iconUrl?: string;
};

interface IPathInfo {
  uri?: string,
  fullPath?: string,
  folder?: string,
  filename?: string, 
  property?: string,
  newFile?: boolean
}

export class FileSystemDataSource extends AbstractDispatcher implements AutoinquirerGet, AutoinquirerPush, AutoinquirerUpdate, AutoinquirerSet, AutoinquirerDelete {
  rootDir: string;
  rootUrl: string;
  protected schemaSource: JsonSchema;

  constructor(rootDir: string, rootUrl: string, schema=filesystemSchema) {
    super();
    this.rootDir = rootDir || process.cwd();
    this.rootUrl = rootUrl || '';
    //console.log("constructor", rootDir, rootUrl);
    // JSONSCHEMA data relative to package path
    this.schemaSource = new JsonSchema(schema);
  }
  public async connect(parentDispatcher: AbstractDispatcher) {
    await this.schemaSource.connect(this);
    this.setParent(parentDispatcher);
   };
  public async close() { };

  public canHandle(options: IDispatchOptions) {
    //const { fullPath, folder, filename, property } = this.getPathInfo(options);
    return options?.itemPath.startsWith(this.rootUrl.slice(1));
  }

  public async isMethodAllowed(methodName, options): Promise<Boolean> {
    return true;
  }

  getDataSource() {
    return this;
  }
  
  getSchemaDataSource() {
    return { ...this, get: (options) => this.getSchema(options) };
  }

  protected getPathInfo(options?: IDispatchOptions) : IPathInfo {
    let fullPath = _.compact([
      ...this.rootDir.split(RegExp('\\|\/')), 
      ...(options?.params?.rootDir || '').split(RegExp('\\|\/')), 
      ...options?.itemPath?.replace(RegExp(`^${options?.parentPath}[\\/|\\\\]?`), '').split(RegExp('\\|\/')) || []
    ]).join('/');
    //console.log( "getPathInfo", { fullPath, options });
    if (!fullPath) return {};

    const pathParts: string[] = fullPath.split('/');
    let folder = '.', filename = '', properties: string[] = [], idx = 0;
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
        const prop = pathParts.pop();
        if (prop) properties.unshift(prop);
      }
    }
    let property = properties.join('/')
    let newFile = false;

    if (!filename && property) {
      newFile = true;
      folder = [folder, dirname(property)].join('/');
      filename = basename(property);
      property = '';
    }

    return { fullPath: fullPath.replace(RegExp(`\/?${property}$`), ''), folder, filename, property, uri: options?.parentPath || '', newFile};  
  };

  protected getFiles(pathInfo: IPathInfo, depth = 1, relativePath = null) : FileElement[] {
    let { fullPath, folder='', filename='' } = pathInfo;
    folder = folder.replace(/\/.\//gm,'/');
    const prefix = this.rootUrl;
    let newFile = fullPath && !fs.existsSync(fullPath);
    if (!newFile && fs.lstatSync(fullPath).isDirectory()) {
      return _.chain(fs.readdirSync(fullPath, { withFileTypes: true }))
        .map((element) => {
          const isDir = element.isDirectory();
          const elementPath = [folder, element.name].join('/').replace(/\/.\//gm, '/');
          const { resourceUrl } = getResourceUrl(elementPath, this.rootUrl);
          const { mimetype, iconUrl } = getMimeTypeAndIcon(elementPath, this.rootUrl);
          const { mtime, size } = getLastModifiedAndSize(elementPath);
          const item: FileElement = {
            //name: element.name, //`${isDir?'[ ':''}${element.name}${isDir?' ]':''}`,
            title: _.startCase(element.name.replace('.md','')),
            slug: _.compact([relativePath, element.name]).join('/'),
            path: [folder, element.name].join('/'),
            lastModifiedDate: moment(mtime).toISOString(),
            type: mimetype,
            size: size,
            isFolder: isDir,
            resourceUrl,
            iconUrl
          };
          if (depth > 1 && isDir) {
            return [item, ...this.getFiles({ 
              fullPath: [fullPath, element.name].join('/'), 
              folder: [folder, element.name].join('/'),
              newFile: false
            }, depth-1, _.compact([relativePath, element.name]).join('/'))]
          }
          return [item];


      })
      .flattenDeep()
      .sortBy([o => !o.isFolder, 'path', 'name'])
      .value();
    } else {
      const elementPath = [folder, filename].join('/').replace(/\/.\//gm, '/');
      const { mimetype, iconUrl } = getMimeTypeAndIcon(elementPath, this.rootUrl);      
      const { mtime, size } = getLastModifiedAndSize(elementPath);
      const { resourceUrl } = getResourceUrl(elementPath, this.rootUrl);
      return [{
        //name: filename,
        title: _.startCase(filename.replace('.md','')),
        slug: filename,
        path: folder.replace(RegExp('^'+this.rootDir+'/'), ''),
        lastModifiedDate: moment(mtime).toISOString(),
        type: mimetype,
        size: size,
        isFolder: false,
        resourceUrl,
        iconUrl
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
    if (!options) return;
    //console.log(`FILESYSTEM push(itemPath: ${options.itemPath}, value: ${options.value}, parentPath: ${options.parentPath}, params: ${options.params})`)
    const { folder='' } = this.getPathInfo(options);
    //console.log(options.files);
    const files = _.castArray(options.files.file);
    await Promise.all(files.map( f => new Promise((resolve, reject) => {
        //console.log(f.filepath, f.originalFilename);
        var source = fs.createReadStream(f.filepath);
        var dest = fs.createWriteStream(join(folder,f.originalFilename));
      
        source.pipe(dest);
        source.on('end', function() { 
          //console.log(`copied ${f.path} to ${join(folder,f.name)}`); 
          fs.unlinkSync(f.filepath);
          resolve(null);
        });
        source.on('error', function(err) { console.log(`error copying ${f.filepath} to ${join(folder,f.originalFilename)}`); reject(err); });      
      }))
    );
    return /* this.get(options) */[];
  }

  public async set(options?: IDispatchOptions) {
    console.log(`FILESYSTEM set(itemPath: ${options.itemPath}, value: ${options.value}, parentPath: ${options.parentPath}, params: ${options.params})`)
  }

  public async update(options?: IDispatchOptions): Promise<any> {
    console.log(`FILESYSTEM update(itemPath: ${options.itemPath}, value: ${options.value}, parentPath: ${options.parentPath}, params: ${options.params})`)
    /*
    if (options?.value !== undefined) {
      if (options?.itemPath) {
        const files = [];
        const path = join(this.rootDir, options?.params?.rootDir);
        for await (const f of getFiles(path, options?.itemPath)) { files.push(f); };
        return files.map((f: FileElement) => {
          const currentPath = join(f.path, f.name);
          const newPath = join(this.rootDir, options?.params?.rootDir, options?.value?.path, options?.value?.name);
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
    if (!options) return;
    const { fullPath, folder, filename, property, uri, newFile } = this.getPathInfo(options);
    //console.log(fullPath, fs.existsSync(fullPath));
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true });
    }
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
