// tslint:disable:no-console

import { isObject } from 'lodash';
import { IProperty, IProxyInfo, IDispatchOptions, Action } from 'autoinquirer';
import { Dispatcher } from 'autoinquirer';
import * as _ from 'lodash';
import { decode } from 'html-entities';
import { AbstractDataSource, IEntryPointInfo } from 'autoinquirer';

import { getName, absolute } from './common';

// tslint:disable-next-line:no-any
export interface ISelectOption {
    label: string;
    value: string;
    path?: string;
    resourceUrl?: string;
    disabled?: boolean;
    [key: string]: any;
}

interface ITemplateOptions {
    label?: string,
    path?: string,
    options?: any[],
    multiple?: boolean,
    groupBy?: string,
    actions?: string[],
}

export async function formlyze(methodName: Action, options?: IDispatchOptions): Promise<any> {
    options = options || {};
    options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
    options.schema = options?.schema || await this.getSchema(options);
    options.value = options?.value || await this.dispatch(methodName, options);

    if (!options.schema) {
        console.log(options)
        throw new Error("Schema cannot be null");
    }
    const { dataSource, entryPointOptions } = await this.getDataSourceInfo(options);        
    //const itemPath = [dataSource !== this && !itemPath.startsWith(entryPointOptions.parentPath) ? entryPointOptions.parentPath : undefined, itemPath].join('/').replace(/^\//, '');
    //console.log({dataSource, options, entryPointOptions})
    const sanitized = await sanitizeJson(dataSource, {...options, ...entryPointOptions });
    if (sanitized?.schema?.widget?.formlyConfig?.templateOptions) {
        sanitized.schema.widget.formlyConfig.templateOptions.expanded = true;
    }
    return {
        type: sanitized?.schema?.widget?.formlyConfig?.componentType || 'form',
        path: options.itemPath,
        ...sanitized
    };
}

async function sanitizeJson(dispatcher: Dispatcher, options: IDispatchOptions) {
    const { itemPath, schema, parentPath } = options;
    let { value } = options;

    const single = isSelect(schema);
    const multiple = isCheckBox(schema);
    const label = decode(await getName(dispatcher, options));
    if ((multiple || single) && !schema.readOnly) {
        const property: IProperty = schema.items || schema;
        const enumOptions = await getEnumOptions(dispatcher, options);
        const item = {
            schema: {
                type: multiple ? "array": "string", 
                title: schema.title,
                enum: enumOptions?.map( (i: any) => i.value || i),
                description: schema.description, 
                widget: { formlyConfig: _.merge({ 
                    type: 'select', 
                    wrappers: _.compact([single && !property.enum && 'form-field-link', 'form-field']),
                    templateOptions: <ITemplateOptions>{ 
                        label, multiple, 
                        options: enumOptions, 
                        groupBy: property?.$data?.groupBy,
                        actions: property?.$data?.actions,
                    } 
                }, { expressionProperties: schema.$expressionProperties }, schema.$widget || {}) }
            },
            model: value || (multiple? []: ''),
        };
        //console.log(multiple?"checkbox": "select", itemPath, JSON.stringify(item, null, 2))
        return item;

    } else if (multiple && schema.readOnly) {
        const model = await getEnumOptions(dispatcher, options);
        return {
            schema: {
                type: 'array', 
                title: label, 
                description: schema.description, 
                readOnly: false,
                items: {
                    type: 'object',
                    properties: { label: { type: 'string' }, path: { type: 'string' } }
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
                    properties: { label: { type: 'string' }, path: { type: 'string' } }
                },
                widget: { formlyConfig: _.merge({ 
                    wrappers: schema.$groupBy && ['groups'],
                    templateOptions: <ITemplateOptions>{ label, path: itemPath, groupBy: schema.$groupBy } 
                }, { expressionProperties: schema.$expressionProperties }, schema.$widget || {}) }
            },
            model: Array.isArray(value) ? await Promise.all(value.map(async (obj, idx) => {
                    const newPath = _.compact([options.parentPath, itemPath, obj.slug || obj._id || idx]).join('/');
                    return { 
                        label: await getName(dispatcher, { itemPath: newPath, value: obj, schema: schema.items, parentPath}), 
                        path: newPath,
                        [`${schema.$groupBy}Id`]: schema.$groupBy && obj[schema.$groupBy],
                        resourceUrl: obj.resourceUrl
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
                isSelect(properties[prop]) || isCheckBox(properties[prop])) {
                if (properties[prop].$visible === false) continue;
                const defaultValue = properties[prop].type === 'object'? {} : (isSelect(properties[prop])? '': []);
                const propKey = properties[prop].type === 'array' && (properties[prop].readOnly || !isCheckBox(properties[prop])) ? `_${prop}` : prop;
                const sanitized = await sanitizeJson(dispatcher, { itemPath: _.compact([itemPath, prop]).join('/'), schema: properties[prop], value: (value && value[prop]) || defaultValue, parentPath });
                safeObj[propKey] = sanitized.model;
                safeSchema.properties[propKey] = {...sanitized.schema, readOnly: schema.readOnly };
            } else {
                const sanitized = await sanitizeJson(dispatcher, { itemPath: _.compact([itemPath, prop]).join('/'), schema: properties[prop], value: value && value[prop], parentPath });
                safeObj[prop] = sanitized.model;
                if (properties[prop].$visible === false) continue;
                safeSchema.properties[prop] = {...sanitized.schema, readOnly: schema.readOnly || properties[prop].readOnly };
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
                    label: decode(await getName(dispatcher, { itemPath, value, schema, parentPath}))
                } 
            }, { expressionProperties: schema.$expressionProperties }, schema.$widget || {})
        } 
    };


    return { schema: schema2, model: value };

}

async function getEnumOptions(dispatcher: Dispatcher, options: IDispatchOptions): Promise<ISelectOption[]> {
    const property: IProperty = options.schema.items || options.schema;
    if (property?.enum) {
        return _.map(property.enum, value => { return { label: value.toString(), value }; });
    }
    if (!property?.$data?.path) {
        return [];
    }
    const dataPath = property?.$data?.path ? absolute(property.$data.path||'', options.itemPath) : '';
    let $schema = await dispatcher.getSchema({ itemPath: dataPath });
    $schema = $schema?.items || $schema;
    const newOptions = { ...options, itemPath: dataPath, schema: $schema };
    const { dataSource, entryPointOptions } = await dispatcher.getDataSourceInfo(newOptions);
    //console.log({entryPointOptions})
    let values = (await dataSource.dispatch(Action.GET, entryPointOptions) || []).filter( ref => {
        //console.log(ref._fullPath, options.value)
        return !options.schema.readOnly || _.includes(options.value, ref._fullPath)
    });
    if (property?.$data?.filterBy) {
        values = _.filter(values, Function('value', `return ${property?.$data?.filterBy};`));
    } 
    if (property?.$data?.orderBy) {
        const order = _.zip(...property.$data.orderBy.map( o => /^!/.test(o)? [o.slice(1), 'desc'] : [o, 'asc']));
        //console.log(order)
        values = _.orderBy(values, order[0], order[1]);
    } 

    const group = property?.$data?.groupBy ? (v) => { return { [`${property.$data.groupBy}Id`]: v[property.$data.groupBy] }; } : () => { };
    const enumOptions = <ISelectOption[]>await Promise.all(values.map(async (value: any) => {
        const newPath = value._fullPath || _.compact([(entryPointOptions?.itemPath || dataPath).replace(/\/?#$/g, ''), value._id || value.slug ||value]).join('/');
        const finalPath = _.compact([entryPointOptions?.parentPath, newPath]).join('/');
        return <ISelectOption>{
            label: decode(isObject(value) ? await getName(dispatcher, {
                itemPath: finalPath,
                value, schema: $schema
            }) : value),
            value: finalPath,
            path: finalPath,
            resourceUrl: value.resourceUrl,
            disabled: options.itemPath.startsWith(finalPath),
            ...group(value)
        };
    }));
    if (!isCheckBox(options.schema) || !enumOptions.length || (options.schema.readOnly && !enumOptions.length) ) { enumOptions.unshift({ label: 'None', value: null }) }
    return enumOptions;
}

function isCheckBox(schema: IProperty): boolean {
    if (schema === undefined) { return false; };

    return schema?.type === 'array' &&
        isSelect(schema.items||{});
}

function isSelect(schema: IProperty): boolean {
    if (schema === undefined) { return false; };

    return schema?.enum !== undefined || schema?.$data?.path !== undefined;
}
