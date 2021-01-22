// tslint:disable:no-console

import { isObject } from 'lodash';
import { Action, IProperty, IProxyInfo, IDispatchOptions } from 'autoinquirer/build/interfaces';
import { Dispatcher } from 'autoinquirer';
import * as Handlebars from 'handlebars';
import * as _ from 'lodash';
import { IDataRenderer, AbstractDispatcher, AbstractDataSource } from 'autoinquirer/build/datasource';
import { generate } from './custom';
import { join, resolve } from 'path';

// tslint:disable-next-line:no-any
export interface ISelectOption {
    label: string;
    value: string;
    disabled?: boolean;
}

interface IEntryPointInfo {
    proxyInfo: IProxyInfo;
    parentPath: string;
    objPath: string;
};

interface ITemplateOptions {
    label?: string,
    path?: string,
    options?: any[],
    multiple?: boolean,
}

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

export class FormlyRenderer extends Dispatcher implements IDataRenderer {

    private async makeRedirect(options?: IDispatchOptions): Promise<any> {
        if (options.query.template) {
            const template = await this.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `/${options.value.template}` });
            const generatedFilename = await generate(options.value, { 
                template: template.content, 
                reference: resolve(process.cwd(), template.reference),
                toc: template.toc || false,
                output: {
                    path: resolve(process.cwd(), 'static'),
                    filename: `${template.title}_${options.value.name}`, 
                    format: template.format || 'docx'
                }
             });
            return { type: 'redirect', url: `http://127.0.0.1:4000/static/${generatedFilename}`, target: '_blank' };
        }
    }

    private async makeBreadcrumb(options?: IDispatchOptions): Promise<any> {
        const parts = options.itemPath.split('/');
        const { dataSource } = await this.getDataSourceInfo({ itemPath: options.itemPath });
        const path = parts[parts.length-1];
        const [cursor, pathParts] = await Promise.all([
            dataSource.convertObjIDToIndex(path, options.itemPath.slice(0, options.itemPath.length - path.length)),
            Promise.all( parts.map( async (_p, idx) => {
                const value = parts.slice(0, idx+1).join('/');
                const { entryPointInfo } = await this.getDataSourceInfo({ itemPath: value });
                return { value, label: (await this.getName({itemPath: value, parentPath: entryPointInfo?.parentPath })).trim() };
            }))
        ]);
        return { type: 'breadcrumb', pathParts, ...cursor };
    }

    public async sanitize(methodName: string, options?: IDispatchOptions): Promise<any> {
        if (methodName === Action.EXIT) { return null; }
        options = options || {};
        options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
        options.schema = options?.schema || await this.getSchema(options);
        options.value = await this.dispatch(methodName, options);

        return this.makeForm(options);
    }

    public async render(methodName: string, options?: IDispatchOptions): Promise<any> {
        if (methodName === Action.EXIT) { return null; }
        options = options || {};
        options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
        options.schema = options?.schema || await this.getSchema(options);
        options.value = await this.dispatch(methodName, options);

        if (options.query.template) return await this.makeRedirect(options);

        return { 
            type: 'layout', 
            children: [
                //await this.makeAuth(options),
                await this.makeBreadcrumb(options),
                await this.makeForm(options)
            ]
        };
        //return this.evaluate(methodName, itemPath, schema, value);
    }

    private async getEnumValues(options: IDispatchOptions)
        : Promise<{ values: any, dataSource?: AbstractDataSource, entryPointInfo?: IEntryPointInfo}> {
        
        const { itemPath, schema } = options;
        const property: IProperty = schema.items || schema;
        if (property.enum) {
            return { values: property.enum};
        }
        if (!property?.$data?.path) {
            return { values: [] };
        }
        const dataPath = absolute(property.$data.path, itemPath);
        const { dataSource, entryPointInfo } = await this.getDataSourceInfo({ itemPath: dataPath });
        const newPath = (dataSource instanceof AbstractDispatcher && entryPointInfo?.parentPath) ?
            await dataSource.convertPathToUri(dataPath.replace(entryPointInfo.parentPath, '').replace(/^\//,'')) :
            dataPath;
        let values = (await dataSource.dispatch('get', { itemPath: newPath }) || []);
        if (property?.$data?.filterBy) {
            values = _.filter(values, Function('value', `return ${property?.$data?.filterBy};`));
        } 
        if (property?.$data?.orderBy) {
            const order = _.zip(...property.$data.orderBy.map( o => /^!/.test(o)? [o.slice(1), 'desc'] : [o, 'asc']));
            //console.log(order)
            values = _.orderBy(values, order[0], order[1]);
        } 

        return { dataSource, entryPointInfo, values };
    }

    private async sanitizeJson(options: IDispatchOptions) {
        const { itemPath, schema, parentPath } = options;
        let { value } = options;

        const single = this.isSelect(schema);
        const multiple = this.isCheckBox(schema);
        const label = await this.getName(options);
        if ((multiple || single) && !schema.readOnly) {
            const property: IProperty = schema.items || schema;
            const dataPath = property?.$data?.path ? absolute(property.$data.path||'', itemPath) : '';
            let $schema = await this.getSchema({ itemPath: dataPath });
            $schema = $schema?.items || $schema;
            const enumValues = await this.getEnumValues(options);
            const group = property?.$data?.groupBy ? (v) => { return { [`${property.$data.groupBy}Id`]: v[property.$data.groupBy]} } : () => {};
            const enumOptions = !property.enum? await Promise.all(enumValues.values.map(async (value: any) => {
                const finalPath = (enumValues?.entryPointInfo?.parentPath ? `${enumValues.entryPointInfo.parentPath}/`: '') +(value._fullPath || `${dataPath}/${value._id || value}`);
                return { 
                    label: isObject(value)? await this.getName({ itemPath: value._fullPath || `${dataPath}/${value._id || value}`, value, schema: $schema, parentPath: enumValues?.entryPointInfo?.parentPath}): value,
                    value: value._fullPath || `${dataPath}/${value._id || value}`,
                    path: finalPath,
                    disabled: itemPath.startsWith(finalPath), 
                    ...group(value)
                };
            })): undefined;
            const item = {
                schema: {
                    type: multiple ? "array": "string", 
                    title: schema.title,
                    enum: enumOptions?.map( (i: any) => i.value || i) || enumValues.values,
                    description: schema.description, 
                    widget: { formlyConfig: _.merge({ 
                        type: 'select', 
                        wrappers: [single && !property.enum ? 'form-field-link': 'form-field'],
                        templateOptions: <ITemplateOptions>{ multiple, options: enumOptions, groupBy: property?.$data?.groupBy } 
                    }, { expressionProperties: schema.$expressionProperties }, schema.$widget || {}) }
                },
                model: value || (multiple? []: ''),
            };
            //console.log(multiple?"checkbox": "select", itemPath, JSON.stringify(item, null, 2))
            return item;

        } else if (multiple && schema.readOnly) {
            const property: IProperty = schema.items || schema;
            const dataPath = property?.$data?.path ? absolute(property.$data.path||'', itemPath) : '';
            let $schema = await this.getSchema({ itemPath: dataPath });
            $schema = $schema?.items || $schema;
            const enumValues = await this.getEnumValues(options);
            const model = (await Promise.all(enumValues.values
                .filter( (v) => value.indexOf(v._fullPath || `${dataPath}/${v._id || v}`) !== -1)
                .map(async (value: any) => {
                    const finalPath = (enumValues?.entryPointInfo?.parentPath ? `${enumValues.entryPointInfo.parentPath}/`: '') +(value._fullPath || `${dataPath}/${value._id || value}`);
                return { 
                    name: isObject(value)? await this.getName({ itemPath: value._fullPath || `${dataPath}/${value._id || value}`, value, schema: $schema, parentPath: enumValues?.entryPointInfo?.parentPath}): value,
                    path: finalPath,
                };
            }))) || [];

            return {
                schema: {
                    type: 'array', 
                    title: label, 
                    description: schema.description, 
                    readOnly: false,
                    items: {
                        type: 'object',
                        properties: { name: { type: 'string' }, path: { type: 'string' } }
                    },
                    widget: { formlyConfig: _.merge({ 
                        templateOptions: <ITemplateOptions>{ label, path: itemPath, readonly: true } 
                    }, { expressionProperties: schema.$expressionProperties }, schema.$widget || {}) }
                },
                model
            }
        } else if (schema.type === 'array') {
            const $order = schema.$orderBy || [];
            if (schema.$groupBy) {
                const group = (v) => { return { [`${schema.$groupBy}Id`]: v[schema.$groupBy]} };
                value = value.map( v => { return {...v, ...group(v)}});
                $order.unshift(schema.$groupBy);
            }                
            if ($order.length) {
                const order = _.zip(...$order.map( o => /^!/.test(o)? [o.slice(1), 'desc'] : [o, 'asc']));
                //console.log(order)
                value = _.orderBy(value, order[0], order[1]);                    
            }                
            return {
                schema: {
                    type: 'array', 
                    title: label, 
                    description: schema.description, 
                    readOnly: schema.readOnly,
                    items: {
                        type: 'object',
                        properties: { name: { type: 'string' }, path: { type: 'string' } }
                    },
                    widget: { formlyConfig: _.merge({ 
                        wrappers: schema.$groupBy && ['groups'],
                        templateOptions: <ITemplateOptions>{ label, path: itemPath, groupBy: schema.$groupBy } 
                    }, { expressionProperties: schema.$expressionProperties }, schema.$widget || {}) }
                },
                model: Array.isArray(value) ? await Promise.all(value.map(async (obj, idx) => {
                        return { 
                            name: await this.getName({ itemPath: `${itemPath}/${obj.slug || obj._id || idx}`, value: obj, schema: schema.items, parentPath}), 
                            path: `${itemPath}/${obj.slug || obj._id || idx}`,
                            [`${schema.$groupBy}Id`]: schema.$groupBy && obj[schema.$groupBy]
                        };
                })) : []
            }
        } else if (schema.type === 'object') {
            const safeObj = {};
            const safeSchema = { 
                type: 'object', 
                title: label, 
                description: schema.description, 
                required: schema.required,
                readOnly: schema.readOnly, 
                properties: {},
                widget: { formlyConfig: _.merge({ 
                    templateOptions: <ITemplateOptions>{ 
                        label, 
                        path: itemPath,
                    } 
                }, { expressionProperties: schema.$expressionProperties }, schema.$widget || {}) }
            };
            const properties = schema.properties ? { ...schema.properties } : {};
            if (schema.patternProperties && isObject(value)) {
                const objProperties = Object.keys(properties) || [];
                // tslint:disable-next-line:no-bitwise
                const otherProperties = Object.keys(value).filter((p: string) => p[0] !== '_' && !~objProperties.indexOf(p));
                for (const key of otherProperties) {
                    const patternFound = Object.keys(schema.patternProperties).find((pattern: string) => RegExp(pattern).test(key));
                    if (patternFound) {
                        properties[key] = schema.patternProperties[patternFound];
                    }
                }
            }

            for (let prop of Object.keys(properties)) {                
                if (properties[prop].type === 'object' || properties[prop].type === 'array' || 
                    this.isSelect(properties[prop]) || this.isCheckBox(properties[prop])) {
                    if (properties[prop].$visible === false) continue;
                    const defaultValue = properties[prop].type === 'object'? {} : (this.isSelect(properties[prop])? '': []);
                    const propKey = properties[prop].type === 'array' && !this.isCheckBox(properties[prop]) ? `_${prop}` : prop;
                    const sanitized = await this.sanitizeJson({ itemPath: `${itemPath}/${prop}`, schema: properties[prop], value: (value && value[prop]) || defaultValue, parentPath });
                    safeObj[propKey] = sanitized.model;
                    safeSchema.properties[propKey] = {...sanitized.schema, readOnly: schema.readOnly };
                } else {
                    const sanitized = await this.sanitizeJson({ itemPath: `${itemPath}/${prop}`, schema: properties[prop], value: value && value[prop], parentPath });
                    safeObj[prop] = sanitized.model;
                    if (properties[prop].$visible === false) continue;
                    safeSchema.properties[prop] = {...sanitized.schema, readOnly: schema.readOnly };
                }
            }
            return { schema: safeSchema, model: safeObj || {} };
        } else if (schema.type === 'string' && (schema.format === 'date' || schema.format === 'date-time')) {
            schema.$widget = _.merge( { type: 'datepicker' }, { expressionProperties: schema.$expressionProperties }, schema.$widget || {}) ;
        }

        const schema2 = {
            ...schema,
            widget: { 
                formlyConfig: _.merge({ 
                    templateOptions: <ITemplateOptions>{ 
                        label: await this.getName({ itemPath, value, schema, parentPath})
                    } 
                }, { expressionProperties: schema.$expressionProperties }, schema.$widget || {})
            } 
        };


        return { schema: schema2, model: value };

    }

    private async makeForm(options: IDispatchOptions): Promise<any> {
        const { itemPath, schema, value } = options;
        const { entryPointInfo } = await this.getDataSourceInfo({ itemPath });        
        //const itemPath = [dataSource !== this && !itemPath.startsWith(entryPointInfo.parentPath) ? entryPointInfo.parentPath : undefined, itemPath].join('/').replace(/^\//, '');

        const sanitized = await this.sanitizeJson({
            itemPath,
            schema,
            value,
            parentPath: entryPointInfo?.parentPath
        });
        if (sanitized?.schema?.widget?.formlyConfig?.templateOptions) {
            sanitized.schema.widget.formlyConfig.templateOptions.expanded = true;
        }
        return {
            type: sanitized?.schema?.widget?.formlyConfig?.componentType || 'form',
            path: itemPath,
            ...sanitized
        };
    }

    private async getName(options: IDispatchOptions): Promise<string> {
        options = options || {};
        options.itemPath = options?.itemPath || ''; // await this.convertPathToUri(options.itemPath) : '';
        options.schema = options?.schema || await this.getSchema(options);
        options.value = options?.value || await this.dispatch('get', options);

        const {value, schema, parentPath=''} = options;
        const key = options.itemPath.split('/').pop();
        let label = '';
        if (value && schema?.$data?.path) {
            return await this.getName({itemPath: `${parentPath}${parentPath?'/':''}${value}`, parentPath});
        }
        if (schema?.$title && value) {
            let parent = {}, parentName = '';
            if (schema?.$title.indexOf('parent') !== -1 || schema?.$title.indexOf('parentName') !== -1) {
                parent = await this.dispatch('get', {...options, itemPath: absolute('..', options.itemPath), schema: options.schema.$parent});
                parentName = await this.getName({itemPath: absolute('..', options.itemPath), schema: options.schema.$parent, value: parent, parentPath});
            }
            const template = Handlebars.compile(schema.$title);
            label = template({...value, parent, parentName }).trim();
            if (label && label.indexOf('/')) {
                label = (await Promise.all(label.split(' ').map(async labelPart => {
                    if (labelPart && labelPart.indexOf('/') > 3) {
                        //console.log(labelPart)
                        const subRefSchema = await this.getSchema({ itemPath: `${parentPath}${parentPath?'/':''}${labelPart}` });
                        if (subRefSchema && !subRefSchema.$data) {
                            return await this.getName({itemPath: `${parentPath}${parentPath?'/':''}${labelPart}`, schema: subRefSchema, parentPath});
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

    private isCheckBox(schema: IProperty): boolean {
        if (schema === undefined) { return false; };

        return schema.type === 'array' &&
            this.isSelect(schema.items||{});
    }

    private isSelect(schema: IProperty): boolean {
        if (schema === undefined) { return false; };

        return schema.enum !== undefined || schema?.$data?.path !== undefined;
    }
}
