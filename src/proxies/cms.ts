import * as fs from "fs";
import { basename, dirname } from 'path';
//import * as del from "delete";
import * as crypto from 'crypto';
import * as _ from "lodash";
import * as moment from 'moment';
import { join } from 'path';
import { lookup } from 'mime-types';

import { Action, IDispatchOptions, IProperty } from 'autoinquirer';
import { AutoinquirerGet, AutoinquirerPush, AutoinquirerUpdate, AutoinquirerSet, AutoinquirerDelete } from 'autoinquirer';

import { absolute } from '../transformers/common';
import { processMeta } from '../transformers/templates';

import * as cmsSchema from './cmsSchema.json';
import { FileSystemDataSource, FileElement } from "./filesystem";

export class CMSDataSource extends FileSystemDataSource implements AutoinquirerGet, AutoinquirerPush, AutoinquirerUpdate {

  constructor(rootDir: string, rootUrl: string, schema=cmsSchema) {
    super(rootDir, rootUrl, schema);
  }

  public canHandle(options: IDispatchOptions) {
    //const { fullPath, folder, filename, property } = this.getPathInfo(options);
    return options?.itemPath?.startsWith(this.rootUrl.slice(1)) || false;
  }

  public async get(options: IDispatchOptions): Promise<FileElement[]|FileElement> {
    //console.log(`FILESYSTEM get(itemPath: ${options.itemPath}, schema: ${JSON.stringify(options.schema)}, value: ${options.value}, parentPath: ${options.parentPath}, params: ${JSON.stringify(options.params)})`)
    const { fullPath, folder, filename, property, newFile } = this.getPathInfo(options);
    const depth = options.params?.depth || options.query?.depth;
    const files = this.getFiles({ fullPath, folder, filename, property }, depth);
    //console.log(`FILES = "${JSON.stringify(files, null, 2)}"`)
    if (filename) {
        if (property) {
          return files[0][property];
        }
        if (!newFile && filename.endsWith('.md')) {
          const content = fs.readFileSync(fullPath).toString();
          const { meta } = processMeta(content);
          
          //console.log(meta);
          return {...files[0], content, ...meta };
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

  public async update(options?: IDispatchOptions) {
    if (!options) return;
    let { fullPath, folder, filename, property, uri, newFile } = this.getPathInfo(options);
    let { title, content } = options.value;
    let needRedirect = newFile;

    const newName = _.kebabCase(title)+'.md';
    const destFolder =  dirname(fullPath.replace(filename, newName));
    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }  

    if (title && filename != newName && !newFile) {
      fs.renameSync(fullPath, fullPath.replace(filename, newName));
      fullPath = fullPath.replace(filename, newName);
      filename = newName;
      needRedirect = true;
    } 
    if (content !== undefined) {
      fs.writeFileSync(fullPath, content);
    }

    if (needRedirect) {
      const url = absolute(filename, folder).replace(this.rootDir, uri) ;
      //console.log({ rootDir: this.rootDir, rootUrl: this.rootUrl, newName, fullPath, folder, filename, property, uri, newFile })
      //console.log({ type: 'redirect', url});
      return { type: 'redirect', url};
    }
    return { title, content };
  }

}
