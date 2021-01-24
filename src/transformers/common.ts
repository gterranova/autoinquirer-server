import { Dispatcher } from 'autoinquirer';
import { IDispatchOptions } from 'autoinquirer/build/interfaces';
import * as Handlebars from 'handlebars';
import * as _ from 'lodash';

export const TransformerQuery = {
    SCHEMA: 'schema',
    LAYOUT: 'layout',
    FORMLY: 'formly',
    BREADCRUMB: 'breadcrumb',
    REDIRECT: 'redirect',
    TEMPLATE: 'template',
};

export function absolute(testPath: string, absolutePath: string): string {
    if (testPath && testPath[0] !== '.') { return testPath; }
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

export async function getName(dispatcher: Dispatcher, options: IDispatchOptions): Promise<string> {
    options = options || {};
    options.itemPath = options?.itemPath || ''; // await this.convertPathToUri(options.itemPath) : '';
    options.schema = options?.schema || await dispatcher.getSchema(options);
    options.value = options?.value || await dispatcher.dispatch('get', options);

    const {value, schema, parentPath=''} = options;
    const key = options.itemPath.split('/').pop();
    let label = '';
    if (value && schema?.$data?.path) {
        return await getName(dispatcher, {itemPath: `${parentPath}${parentPath?'/':''}${value}`, parentPath});
    }
    if (schema?.$title && value) {
        let parent = {}, parentName = '';
        if (schema?.$title.indexOf('parent') !== -1 || schema?.$title.indexOf('parentName') !== -1) {
            parent = await dispatcher.dispatch('get', {...options, itemPath: absolute('..', options.itemPath), schema: options.schema.$parent});
            parentName = await getName(dispatcher, {itemPath: absolute('..', options.itemPath), schema: options.schema.$parent, value: parent, parentPath});
        }
        const template = Handlebars.compile(schema.$title);
        label = template({...value, parent, parentName }).trim();
        if (label && label.indexOf('/')) {
            label = (await Promise.all(label.split(' ').map(async labelPart => {
                if (labelPart && labelPart.indexOf('/') > 3) {
                    //console.log(labelPart)
                    const subRefSchema = await dispatcher.getSchema({ itemPath: `${parentPath}${parentPath?'/':''}${labelPart}` });
                    if (subRefSchema && !subRefSchema.$data) {
                        return await getName(dispatcher, {itemPath: `${parentPath}${parentPath?'/':''}${labelPart}`, schema: subRefSchema, parentPath});
                    }    
                }
                return labelPart;
            }))).join(' ').trim();
        }
    } else if (schema?.title) {
        label = schema.title;
    } /* else if (schema.type === 'array' && value && value.length && !key) {
        label = (await Promise.all(value.map(async i => await this.getName(i, key, schema.items)))).join(', ');
    }*/
    if (!label) {
        label = (value && (value.title || value.name)) || key.toString() || `[${schema.type}]`;
    }
    if (label && label.length > 100) {
        label = `${label.slice(0, 97)}...`;
    }
    return label;
    //const result = label.replace(/\s*([A-Z]{2,})/g, " $1").replace(/\s*([A-Z][a-z])/g, " $1").trim();
    //return result.charAt(0).toUpperCase() + result.slice(1);
}

