import * as fs from "fs";
import { join } from 'path';
import * as del from "delete";
import { Dispatcher, DataSource } from 'autoinquirer';

import * as crypto from 'crypto';

function hash(key) {
  return crypto.pbkdf2Sync('secret', JSON.stringify(key), 100, 12, 'sha1').toString('hex');  // '3745e48...08d59ae'
}


async function* getFiles(dir, folderId = '', parentId = '') {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const element: FileElement = {
      name: item.name,
      dir,
      isFolder: item.isDirectory(),
      parent: parentId,
    };
    element._id = hash(element);
    if (folderId === parentId) {
      yield element;
    } else if (item.isDirectory()) {
      const res = join(dir, item.name);
      yield* getFiles(res, folderId, element._id);
    }
  }
}

async function* getFile(dir, elementId, parentId = '') {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const element: FileElement = {
      name: item.name,
      dir,
      isFolder: item.isDirectory(),
      parent: parentId,
    };
    element._id = hash(element);
    if (elementId === element._id) {
      yield element;
      break;
    } else if (item.isDirectory()) {
      const res = join(dir, item.name);
      yield* getFile(res, elementId, element._id);
    }
  }
}

export interface FileElement {
  _id?: string;
  isFolder: boolean;
  name: string;
  dir: string;
  parent: string;
};

export class FileSystemDataSource extends DataSource {
  rootDir: string;
  constructor(rootDir?: string) {
    super();
    this.rootDir = rootDir || '/';
  }
  public async connect() { };
  public async close() { };

  public async get(itemPath?: string, schema?: any, value?: any, parentPath?: string, params?: any): Promise<FileElement[]> {
    const files = [];
    const dir = join(this.rootDir, params.rootDir);
    for await (const f of getFiles(dir, itemPath || '')) { files.push({ ...f, dir: f.dir.replace(dir, '').replace('\\', '/') }); };
    return files;
  };

  public async update(itemPath: string, _: any, value: FileElement, parentPath?: string, params?: any) {
    if (value !== undefined) {
      if (itemPath) {
        const files = [];
        const dir = join(this.rootDir, params.rootDir);
        for await (const f of getFile(dir, itemPath)) { files.push(f); };
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
    if (itemPath) {
      const files = [];
      const dir = join(this.rootDir, params.rootDir);
      for await (const f of getFile(dir, itemPath)) { files.push(f); };
      del(files.map((f: FileElement) => join(f.dir, f.name)));
    }
  };

  public async dispatch(methodName: string, itemPath?: string, schema?: any, value?: any, parentPath?: string, params?: any): Promise<any> {
    if (!this[methodName]) {
      throw new Error(`Method ${methodName} not implemented`);
    }

    // tslint:disable-next-line:no-return-await
    return await this[methodName].call(this, itemPath, schema, value, parentPath, params);
  };
}

const DIST_FOLDER = join(process.cwd(), 'dist/');

export const createDatasource = async function (
  schemaFile,
  dataFile,
  renderer?
) {
  // jshint ignore:line

  const dispatcher = new Dispatcher(schemaFile, dataFile, renderer);
  dispatcher.registerProxy('filesystem', new FileSystemDataSource(DIST_FOLDER));
  await dispatcher.connect(); // jshint ignore:line
  return dispatcher;
};
