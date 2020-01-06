import * as fs from "fs";
import { join } from 'path';
import * as del from "delete";
import { DataSource, JsonSchema } from 'autoinquirer';

import * as crypto from 'crypto';
import { IProperty } from '../../autoinquirer/build/src/interfaces';

function hash(key) {
  return crypto.pbkdf2Sync('secret', JSON.stringify(key), 100, 12, 'sha1').toString('hex');  // '3745e48...08d59ae'
}


async function* getFiles(dir, selectedId = '', parent?: FileElement) {
    const pathParts = selectedId.split('/');
    const currentPath = pathParts[0] || '';
    const remainingPath = pathParts.slice(1).join('/');

  const items = fs.readdirSync(dir, { withFileTypes: true });
  //console.log(`FILES in ${dir}: currentPath ${currentPath} - remainingPath ${remainingPath}`);
  for (const item of items) {
    const element: FileElement = {
      name: item.name,
      slug: item.name,
      dir,
      isFolder: item.isDirectory(),
      selectedFile: false
    };
    element._id = hash(element);
    if (~[element._id, element.slug].indexOf(currentPath) && !element.isFolder) {
      element.selectedFile = true;
      yield element;
      break;
    } else if (selectedId === '' || ((parent && ~[parent._id, parent.slug].indexOf(currentPath)) && remainingPath === '' && element.isFolder)) {
      yield element;
    } else if (~[element._id, element.slug].indexOf(currentPath) && element.isFolder) {
        const res = join(dir, item.name);
        yield* getFiles(res, pathParts.slice(1).join('/'), element);
    }
  }
}

export interface FileElement {
  _id?: string;
  isFolder: boolean;
  name: string;
  slug: string;
  dir: string;
  selectedFile: boolean;
};

export class FileSystemDataSource extends DataSource {
  rootDir: string;
  constructor(rootDir?: string) {
    super();
    this.rootDir = rootDir || '/';
  }
  public async connect() { };
  public async close() { };

  public async getSchema(itemPath?: string, _schemaSource?: JsonSchema, parentPath?: string, params?: any): Promise<IProperty> {
    //console.log(`FILESYSTEM getSchema(itemPath: ${itemPath} ... parentPath?: ${parentPath}, params?: ${params})`);
    const fileSchema = {
      type:"object", title:"File",
      properties:{
        name:{ type: "string", title:"Name"},
        slug:{ type: "string", title:"Slug", readOnly: true},
        dir:{ type: "string", title:"Dir", readOnly: true},
        isFolder:{ type: "boolean", title:"isFolder", readOnly: true}
      }
    };
    const folderSchema = { type: "array", title: itemPath, items: fileSchema };
    const files = [];
    const dir = join(this.rootDir, params.rootDir);
    for await (const f of getFiles(dir, itemPath.replace(RegExp(`^${parentPath}`),''))) { files.push({ ...f, dir: f.dir.replace(dir, '') /*.replace('\\', '/')*/ }) };
    //console.log(`FILES = "${JSON.stringify(files)}"`)
    if (files.length === 1 && files[0].selectedFile === true) {
        if (itemPath.endsWith(files[0].name)) {
            fileSchema['title'] = join(parentPath, files[0]['dir'], files[0]['name']);
            return fileSchema;    
        } else {
            const property = itemPath.slice(itemPath.lastIndexOf(files[0].name)+ files[0].name.length+1);
            //console.log("FOUND", property, itemPath, JSON.stringify(files[0]), JSON.stringify(files[0][property]))
            return fileSchema.properties[property] || folderSchema;
        }
    } 
    folderSchema['title'] = join(parentPath, files[0]['dir']);
    return folderSchema;
  }

  public async get(itemPath?: string, schema?: any, value?: any, parentPath?: string, params?: any): Promise<FileElement[]|FileElement> {
    //console.log(`FILESYSTEM get(itemPath: ${itemPath}, schema: ${JSON.stringify(schema)}, value: ${value}, parentPath: ${parentPath}, params: ${JSON.stringify(params)})`)
    const files = [];
    const dir = join(this.rootDir, params.rootDir);
    for await (const f of getFiles(dir, itemPath || '')) { files.push({ ...f, dir: f.dir.replace(dir, '') /*.replace('\\', '/')*/ }) };
    //console.log(`FILES = "${JSON.stringify(files)}"`)
    if (files.length === 1 && files[0] && files[0].selectedFile === true) {
        if (itemPath.endsWith(files[0].name)) {
            return files[0];
        } else {
            const property = itemPath.slice(itemPath.lastIndexOf(files[0].name)+ files[0].name.length+1);
            //console.log("FOUND", property, itemPath, JSON.stringify(files[0]), JSON.stringify(files[0][property]))
            return files[0][property];
        }
    }    
    return files;
  };

  public async update(itemPath: string, _: any, value: FileElement, parentPath?: string, params?: any) {
    console.log(`FILESYSTEM update(itemPath: ${itemPath}, value: ${value}, parentPath: ${parentPath}, params: ${params})`)
    if (value !== undefined) {
      if (itemPath) {
        const files = [];
        const dir = join(this.rootDir, params.rootDir);
        for await (const f of getFiles(dir, itemPath)) { files.push(f); };
        return files.map((f: FileElement) => {
          const currentPath = join(f.dir, f.name);
          const newPath = join(this.rootDir, params.rootDir, value.dir, value.name);
          if (currentPath !== newPath) {
            fs.renameSync(currentPath, newPath)
          }
        });
      }
      return value;
    }
  }

  public async del(itemPath?: string, schema?: any, value?: any, parentPath?: string, params?: any) {
    console.log(`FILESYSTEM del(itemPath: ${itemPath}, schema: ${schema}, value: ${value}, parentPath: ${parentPath}, params: ${params})`)
    if (itemPath) {
      const files = [];
      const dir = join(this.rootDir, params.rootDir);
      for await (const f of getFiles(dir, itemPath)) { files.push(f); };
      del(files.map((f: FileElement) => join(f.dir, f.name)));
    }
  };

  public async dispatch(methodName: string, itemPath?: string, schema?: any, value?: any, parentPath?: string, params?: any): Promise<any> {
    //console.log(`FILESYSTEM dispatch(methodName: ${methodName}, itemPath: ${itemPath}, schema: ${schema}, value: ${value}, parentPath: ${parentPath}, params: ${JSON.stringify(params)})`)
    if (!this[methodName]) {
      throw new Error(`Method ${methodName} not implemented`);
    }

    // tslint:disable-next-line:no-return-await
    return await this[methodName].call(this, itemPath, schema, value, parentPath, params);
  };
}
