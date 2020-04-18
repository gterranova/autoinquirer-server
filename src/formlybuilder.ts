// tslint:disable:no-console

import { isObject } from 'lodash';
import { Action, IProperty, IProxyInfo, IDispatchOptions } from 'autoinquirer/build/interfaces';
import { Dispatcher } from 'autoinquirer';
import { evalExpr } from 'autoinquirer/build/utils';
import * as Handlebars from 'handlebars';
import * as _ from 'lodash';
import { IDataRenderer, AbstractDispatcher, AbstractDataSource } from 'autoinquirer/build/datasource';

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

    private async makeBreadcrumb(options?: IDispatchOptions): Promise<any> {
        const pathParts = options.itemPath.split('/');
        return {
            type: 'breadcrumb',
            path: options.itemPath,
            items: pathParts? await Promise.all( pathParts.map( async (_p, idx) => {
                const value = pathParts.slice(0, idx+1).join('/');
                return { value, label: (await this.getName({itemPath: value, parentPath: options.parentPath })).trim() };
            })): []
        };
    }

    public async render(methodName: string, options?: IDispatchOptions): Promise<any> {
        if (methodName === Action.EXIT) { return null; }
        options = options || {};
        options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
        options.schema = options?.schema || await this.getSchema(options);
        options.value = await this.dispatch(methodName, options);

        return { components: [
            await this.makeBreadcrumb(options),
            await this.makeForm(options)
        ] };
        //return this.evaluate(methodName, itemPath, schema, value);
    }

    private async checkAllowed(schema: IProperty, parentValue: any): Promise<boolean> {
        if (!schema || !schema.depends) { return true; }
        return parentValue ? !!evalExpr(schema.depends, parentValue) : true;
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

        return { dataSource, entryPointInfo, values: (await dataSource.dispatch('get', { itemPath: newPath }) || []) };
    }

    private async sanitizeJson(options: IDispatchOptions) {
        const { itemPath, schema, value, parentPath } = options;

        const single = this.isSelect(schema);
        const multiple = this.isCheckBox(schema);
        const label = await this.getName(options);
        if ((multiple || single) && !schema.readOnly) {
            const property: IProperty = schema.items || schema;
            const dataPath = property?.$data?.path ? absolute(property.$data.path||'', itemPath) : '';
            let $schema = await this.getSchema({ itemPath: dataPath });
            $schema = $schema?.items || $schema;
            const enumValues = await this.getEnumValues(options);
            const enumOptions = !property.enum? await Promise.all(enumValues.values.map(async (value: any) => {
                return { 
                    label: isObject(value)? await this.getName({ itemPath: value._fullPath || `${dataPath}/${value._id || value}`, value, schema: $schema, parentPath: enumValues?.entryPointInfo?.parentPath}): value,
                    value: value._fullPath || `${dataPath}/${value._id || value}`,
                };
            })): undefined;
            const item = {
                schema: {
                    type: multiple ? "array": "string", 
                    title: label,
                    enum: enumOptions?.map( (i: any) => i.value || i) || enumValues.values,
                    description: schema.description, 
                    widget: { formlyConfig: { 
                        type: 'select', 
                        wrappers: [single && !property.enum ? 'form-field-link': 'form-field'],
                        templateOptions: { label, multiple, options: enumOptions } 
                    } }
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
                return { 
                    name: isObject(value)? await this.getName({ itemPath: value._fullPath || `${dataPath}/${value._id || value}`, value, schema: $schema, parentPath: enumValues?.entryPointInfo?.parentPath}): value,
                    path: value._fullPath || `${dataPath}/${value._id || value}`,
                };
            }))) || [];

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
                    widget: { formlyConfig: { 
                        type: schema.$widget, 
                        wrappers: ['accordion'],
                        templateOptions: { label, path: itemPath } 
                    } }
                },
                model
            }
        } else if (schema.type === 'array') {
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
                    widget: { formlyConfig: { 
                        type: schema.$widget, 
                        wrappers: ['accordion'],
                        templateOptions: { label, path: itemPath } 
                    } }
                },
                model: Array.isArray(value) ? await Promise.all(value.map(async (obj, idx) => {
                        return { 
                            name: await this.getName({ itemPath: `${itemPath}/${obj.slug || obj._id || idx}`, value: obj, schema: schema.items, parentPath}), 
                            path: `${itemPath}/${obj.slug || obj._id || idx}` };
                })) : []
            }
        } else if (schema.type === 'object') {
            const safeObj = {};
            const safeSchema = { 
                type: 'object', 
                title: label, 
                description: schema.description, 
                properties: {},
                widget: { formlyConfig: { type: schema.$widget, 
                    wrappers: ['accordion'],
                    templateOptions: { 
                        label, 
                        path: itemPath,
                    } 
                } }
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
                    const defaultValue = properties[prop].type === 'object'? {} : (this.isSelect(properties[prop])? '': []);
                    const propKey = properties[prop].type === 'array' && !this.isCheckBox(properties[prop]) ? `_${prop}` : prop;
                    const sanitized = await this.sanitizeJson({ itemPath: `${itemPath}/${prop}`, schema: properties[prop], value: (value && value[prop]) || defaultValue, parentPath });
                    safeSchema.properties[propKey] = sanitized.schema;
                    safeObj[propKey] = sanitized.model;
                    safeSchema.properties[propKey].disabled = !(await this.checkAllowed(properties[prop], value))
                } else {
                    const sanitized = await this.sanitizeJson({ itemPath: `${itemPath}/${prop}`, schema: properties[prop], value: value && value[prop], parentPath });
                    safeSchema.properties[prop] = sanitized.schema;
                    safeObj[prop] = sanitized.model;
                    safeSchema.properties[prop].disabled = !(await this.checkAllowed(properties[prop], value))
                }
            }
            return { schema: safeSchema, model: safeObj || {} };
        } else if (schema.type === 'string' && (schema.format === 'date' || schema.format === 'date-time')) {
            schema.$widget = schema.$widget || 'datepicker';
        }

        const schema2 = {
            ...schema,
            widget: { 
                formlyConfig: { 
                    type: schema.$widget, 
                    templateOptions: { 
                        label: await this.getName({ itemPath, value, schema, parentPath})
                    } 
                }
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
        return {
            type: 'form',
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
                parent = await this.dispatch('get', {...options, itemPath: absolute('..', options.itemPath)});
                parentName = await this.getName({itemPath: absolute('..', options.itemPath), value: parent, parentPath});
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
        } else if ((schema?.type === 'object' || schema?.type === 'array') && schema?.title) {
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
        const result = label.replace(/\s*([A-Z]{2,})/g, " $1").replace(/\s*([A-Z][a-z])/g, " $1");
        return result.charAt(0).toUpperCase() + result.slice(1);
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
