// tslint:disable:no-console

import { isObject } from 'lodash';
import { IProperty, IDispatchOptions, Action } from 'autoinquirer';
import { Dispatcher } from 'autoinquirer';
import * as _ from 'lodash';
import { decode } from 'html-entities';

import { getName, absolute, fullPath } from './common';

// tslint:disable-next-line:no-any
export interface ISelectOption {
    label: string;
    value: string;
    path?: string;
    resourceUrl?: string;
    iconUrl?: string;
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
    if (/^archived\/?/.test(options.itemPath)) {
        options.itemPath = options.itemPath.replace(/^archived\/?/, '');
        options.params = {...options.params, archived: true };
    }
    if (options.params?.archived && methodName !== Action.GET) 
        throw new Error(`Method ${methodName} not implemented for archived items`);
    const { archived } = (options.params || {});
    options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
    options.schema = options?.schema || await this.getSchema(options);
    options.value = options?.value || await this.dispatch(methodName, options);

    if (!options.schema) {
        //console.log(options)
        throw new Error("Schema cannot be null");
    }
    //const { dataSource, entryPointOptions } = await this.getDataSourceInfo(options);        
    //const itemPath = [dataSource !== this && !itemPath.startsWith(entryPointOptions.parentPath) ? entryPointOptions.parentPath : undefined, itemPath].join('/').replace(/^\//, '');
    //console.log({dataSource, options, entryPointOptions})
    const sanitized = await sanitizeJson(this, options);
    if (sanitized?.schema?.widget?.formlyConfig?.props) {
        sanitized.schema.widget.formlyConfig.props.expanded = true;
    }
    if (sanitized?.schema?.widget?.formlyConfig?.expressionProperties && /parent/.test(Object.values(sanitized?.schema?.widget?.formlyConfig?.expressionProperties).join())) {
        sanitized.schema.widget.formlyConfig.expressionProperties = undefined;
    }
    if (sanitized?.schema?.widget?.formlyConfig?.hideExpression && /parent/.test(sanitized?.schema?.widget?.formlyConfig?.hideExpression)) {
        sanitized.schema.widget.formlyConfig.hideExpression = undefined;
    }
    return {
        type: sanitized?.schema?.widget?.formlyConfig?.componentType || 'form',
        path: fullPath(/*entryPointOptions?.parentPath*/null, options.itemPath, options.params?.archived),
        ...sanitized
    };
}

async function sanitizeJson(dispatcher: Dispatcher, options: IDispatchOptions) {
    const { itemPath, schema, parentPath } = options;
    const { archived } = (options.params || {});
    //schema.readOnly = schema.readOnly && !archived;
    let { value } = options;

    const single = isSelect(schema);
    const multiple = isCheckBox(schema);
    const label = decode(await getName(dispatcher, options));
    if ((multiple || single) && !schema.readOnly && !archived) {
        const property: IProperty = schema.items || schema;
        const enumOptions = await getEnumOptions(dispatcher, options);
        value = multiple? value.map( v => fullPath(parentPath, v, archived)): value;
        const item = {
            schema: {
                type: multiple ? "array": "string", 
                title: schema.title,
                enum: enumOptions?.map( (i: any) => i.value || i),
                description: schema.description, 
                widget: { formlyConfig: _.merge({ 
                    type: 'select', 
                    wrappers: _.compact([single && !property.enum && 'form-field-link', 'form-field']),
                    props: <ITemplateOptions>{ 
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

    } else if ((multiple || single) && (schema.readOnly || archived)) {
        return {
            schema: {
                type: multiple ? "array": "string", 
                title: label, 
                description: schema.description, 
                readOnly: true,
                items: multiple ?{
                    type: 'object',
                    properties: { label: { type: 'string' }, path: { type: 'string' } }
                }: undefined,
                widget: { formlyConfig: _.merge({ 
                    props: <ITemplateOptions>{ 
                        label, 
                        path: fullPath(parentPath, itemPath, archived), 
                        disabled: true,
                        expanded: true
                    } 
                }, !archived?{ expressionProperties: schema.$expressionProperties }: {}, schema.$widget || {}) }
            },
            model: single? 
                (value? await getName(dispatcher, { itemPath: fullPath(parentPath, value, archived) }): ''): 
                (value.length? await Promise.all(value.map(async i => {
                    const itemPath = fullPath(parentPath, i, archived);
                    return { 
                        label: await getName(dispatcher, { itemPath }),
                        path: itemPath
                    }
                })): [ { label: 'None' }])
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
                readOnly: schema.readOnly || archived,
                items: {
                    type: 'object',
                    properties: { label: { type: 'string' }, path: { type: 'string' } }
                },
                widget: { formlyConfig: _.merge({ 
                    wrappers: schema.$groupBy && ['groups'],
                    props: <ITemplateOptions>{ 
                        label, 
                        path: fullPath(parentPath, itemPath, archived), 
                        groupBy: schema.$groupBy,
                        expanded: archived 
                    } 
                }, !archived?{ expressionProperties: schema.$expressionProperties }:{}, schema.$widget || {}) }
            },
            model: Array.isArray(value) ? await Promise.all(value.map(async (obj, idx) => {
                    const newPath = fullPath(parentPath, itemPath, archived, obj.slug || obj._id || idx);
                    return { 
                        label: await getName(dispatcher, { 
                            itemPath: newPath, 
                            value: obj, 
                            schema: schema.items, 
                            parentPath,
                            params: options.params
                        }), 
                        path: newPath,
                        [`${schema.$groupBy}Id`]: schema.$groupBy && obj[schema.$groupBy],
                        resourceUrl: obj.resourceUrl,
                        iconUrl: obj.iconUrl,
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
            readOnly: schema.readOnly || archived, 
            properties: {},
            widget: { formlyConfig: _.merge({ 
                props: <ITemplateOptions>{ 
                    label, 
                    path: fullPath(parentPath, itemPath, archived), 
                    expanded: archived,
                    disabled: archived,
                } 
            }, !archived?{ expressionProperties: schema.$expressionProperties }:{}, schema.$widget || {}) }
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
                const sanitized = await sanitizeJson(dispatcher, { 
                    itemPath: fullPath(parentPath, itemPath, archived, prop), 
                    schema: properties[prop], 
                    value: (value && value[prop]) || defaultValue, 
                    parentPath,
                    params: options.params
                 });
                safeObj[propKey] = sanitized.model;
                safeSchema.properties[propKey] = {...sanitized.schema, readOnly: schema.readOnly || archived };
            } else {
                const sanitized = await sanitizeJson(dispatcher, { 
                    itemPath: fullPath(parentPath, itemPath, archived, prop), 
                    schema: properties[prop], 
                    value: value && value[prop], 
                    parentPath,
                    params: options.params
                 });
                safeObj[prop] = sanitized.model;
                if (properties[prop].$visible === false) continue;
                safeSchema.properties[prop] = {...sanitized.schema, readOnly: schema.readOnly || properties[prop].readOnly || archived };
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
                props: <ITemplateOptions>{ 
                    label: decode(await getName(dispatcher, { 
                        itemPath, 
                        value, 
                        schema, 
                        parentPath, 
                        params: options.params
                    })),
                    disabled: archived
                } 
            }, !archived?{ expressionProperties: schema.$expressionProperties }:{}, schema.$widget || {})
        } 
    };


    return { schema: schema2, model: value };

}

async function getEnumOptions(dispatcher: Dispatcher, options: IDispatchOptions): Promise<ISelectOption[]> {
    const { archived } = options.params || {};
    const property: IProperty = options.schema.items || options.schema;
    if (property?.enum) {
        return _.map(property.enum, value => { return { label: value.toString(), value }; });
    }
    if (!property?.$data?.path) {
        return [];
    }
    const dataPath = property?.$data?.path ? absolute(property.$data.path||'', options.itemPath) : '';
    let $schema = await dispatcher.getSchema({ itemPath: dataPath, params: options.params });
    // $schema = $schema?.items || $schema;
    const newOptions = { ...options, itemPath: dataPath, schema: $schema };
    let { dataSource, entryPointOptions } = await dispatcher.getDataSourceInfo(newOptions);
    entryPointOptions.params = {...entryPointOptions.params, ...(property?.$data?.params || {})}

    let values = (await dataSource.dispatch(Action.GET, {...entryPointOptions, 
        // TODO: understand why
        itemPath: entryPointOptions.itemPath.replace(/^#\/?/,'') 
    }) || []);
    if (!_.isArray(values)) {
        console.log("EXPECTED ARRAY", {entryPointOptions, values });
        throw new Error("EXPECTED ARRAY");
    }
    values = values.filter( ref => {
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
        const newPath = value._fullPath || fullPath(null, (entryPointOptions?.itemPath || dataPath).replace(/\/?#$/g, ''), null, value._id || value.slug ||value);
        const finalPath = fullPath(entryPointOptions?.parentPath, newPath, archived);
        return <ISelectOption>{
            label: decode(isObject(value) ? await getName(dispatcher, {
                itemPath: finalPath,
                value, 
                schema: $schema.items || $schema,
                params: options.params
            }) : value),
            value: finalPath,
            path: finalPath,
            resourceUrl: value.resourceUrl,
            iconUrl: value.iconUrl,
            disabled: options.itemPath.startsWith(finalPath),
            ...group(value)
        };
    }));
    if (!isCheckBox(options.schema) || !enumOptions.length || 
        (options.schema.readOnly && !enumOptions.length) ) 
            { enumOptions.unshift({ label: 'None', value: null }) }
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
