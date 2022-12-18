import { AbstractDataSource } from 'autoinquirer';
import { Action, IDispatchOptions } from 'autoinquirer';
import { processMeta } from '../transformers/templates';
import * as Handlebars from 'handlebars';
import * as _ from 'lodash';

export const TransformerQuery = {
    SCHEMA: 'schema',
    LAYOUT: 'layout',
    FORMLY: 'formly',
    BREADCRUMB: 'breadcrumb',
    REDIRECT: 'redirect',
    TEMPLATE: 'template',
    REPORT: 'report',
    SIDENAV: 'sidenav',
    PAGE: 'page',
};

export function absolute(testPath: string, absolutePath: string): string {
    if (testPath && testPath[0] !== '.') { return [absolutePath, testPath].join('/'); }
    if (!testPath) { return absolutePath; }
    const p0 = absolutePath.split('/');
    const rel = testPath.split('/');
    while (rel.length) { 
        const t = rel.shift(); 
        if (t === '.' || t === undefined) { continue; } 
        else if (t === '..') { 
            if (!p0.length) {  
                continue;
            }
            p0.pop(); 
        } else { p0.push(t) } 
    }

    return p0.join('/');
}

export function fullPath(parentPath: string, itemPath: string, archived: boolean, propName?: string) {
    return _.compact([parentPath, archived && 'archived', itemPath, propName]).join('/')
}

export async function getName(dispatcher: AbstractDataSource, options: IDispatchOptions): Promise<string> {
    options = options || {};
    options.itemPath = options?.itemPath || ''; // await this.convertPathToUri(options.itemPath) : '';
    options.schema = options?.schema || await dispatcher.getSchema(options);
    options.value = options?.value || await dispatcher.dispatch(Action.GET, options);

    const {value, schema, parentPath=''} = options;
    const key = (options.itemPath||parentPath).split('/').pop();
    let label = '';
    //if (value && schema?.$data?.path) {
    //    return await getName(dispatcher, {itemPath: `${parentPath}${parentPath?'/':''}${value}`, parentPath});
    //}
    if (schema?.$title && value) {
        let parent = {}, parentName = '';
        if (schema?.$title.indexOf('parent') !== -1 || schema?.$title.indexOf('parentName') !== -1) {
            parent = await dispatcher.dispatch(Action.GET, { itemPath: absolute('..', options.itemPath), schema: options.schema.$parent});
            parentName = await getName(dispatcher, {
                itemPath: absolute('..', options.itemPath), 
                schema: options.schema.$parent, 
                value: parent, 
                parentPath,
                params: options.params
            });
        }
        const template = Handlebars.compile(schema.$title);
        label = template({parent, parentName, options, key, ...value }).trim();
        if (label && label.indexOf('/')) {
            label = (await Promise.all(label.split(' ').map(async labelPart => {
                if (labelPart && labelPart.indexOf('/') > 3) {
                    //console.log(labelPart)
                    const subRefSchema = await dispatcher.getSchema({ 
                        itemPath: `${parentPath}${parentPath?'/':''}${labelPart}`,
                        params: options.params 
                    });
                    if (subRefSchema && !subRefSchema.$data) {
                        return await getName(dispatcher, {
                            itemPath: `${parentPath}${parentPath?'/':''}${labelPart}`, 
                            schema: subRefSchema, 
                            parentPath,
                            params: options.params
                        });
                    }    
                }
                return labelPart;
            }))).join(' ').trim();
        }
    } /* else if (schema.type === 'array' && value && value.length && !key) {
        label = (await Promise.all(value.map(async i => await this.getName(i, key, schema.items)))).join(', ');
    }*/
    if (value?.content) {
        const { meta } = processMeta(value.content);
        label = (<any>meta)?.title;
    }
    if (!label) {
        label = schema?.title || (value && (value.title || value.name)) || key.toString() || `[${schema.type}]`;
    }
    if (label && label.length > 100) {
        label = `${label.slice(0, 97)}...`;
    }
    return label;
    //const result = label.replace(/\s*([A-Z]{2,})/g, " $1").replace(/\s*([A-Z][a-z])/g, " $1").trim();
    //return result.charAt(0).toUpperCase() + result.slice(1);
}

