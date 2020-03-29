// tslint:disable:no-console

import { Action, IPrompt, IProperty } from 'autoinquirer/build/src/interfaces';

import { DataSource, DataRenderer } from 'autoinquirer/build/src/datasource';
import { backPath, evalExpr, getType } from 'autoinquirer/build/src/utils';
import * as Handlebars from 'handlebars';

// tslint:disable-next-line:no-any
interface Item extends IPrompt {
    model: any;
    fields: any;
};

export interface ISelectOption {
    label: string;
    value: string;
    disabled?: boolean;
}

export function absolute(testPath: string, absolutePath: string): string {
    if (testPath && testPath[0] === '/') { return testPath; }
    if (!testPath) { return absolutePath; }
    const p0 = absolutePath.split('/');
    const rel = testPath.split('/');
    while (rel.length) { 
        const t = rel.shift(); 
        if (t === '.') { continue; } 
        else if (t === '..') { 
            if (!p0.length) {  
                continue;
            }
            p0.pop(); 
        } else { p0.push(t) } 
    }

    return p0.join('/');
}

export class FormlyBuilder extends DataRenderer {
    private datasource: DataSource;

    public setDatasource(datasource: DataSource) {
        this.datasource = datasource;
        // TODO: fix async helpers
        Handlebars.registerHelper("resolve", value => this.datasource.dispatch('get', value) || '');
    }

    private async makeBreadcrumb(itemPath: string, propertySchema: IProperty, propertyValue: Item): Promise<any> {
        const pathParts = itemPath.split('/');
        return {
            type: 'breadcrumb',
            path: itemPath,
            parts: pathParts? await Promise.all( pathParts.map( async (p, idx) => {
                const path = pathParts.slice(0, idx+1).join('/');
                const value = await this.datasource.dispatch('get', path) || [];
                const schema = await this.datasource.getSchema(path);
                return { path, label: (await this.getName(value, p, schema)).trim() };
            })): []
        };
    }

    public async render(methodName: string, itemPath: string, propertySchema: IProperty, propertyValue: Item, datasource?: DataSource): Promise<any> {
        if (propertySchema.type === 'object' && Object.keys(propertySchema.properties).length === 1) {
            const singleProperty = Object.keys(propertySchema.properties)[0];
            itemPath = `${itemPath}${itemPath?'/':''}${singleProperty}`;
            propertySchema = propertySchema.properties[singleProperty];
            propertyValue = propertyValue[singleProperty];
        }

        if (methodName === Action.EXIT) { return null; }
        if (datasource) this.datasource = datasource;
        return { components: [
            await this.makeBreadcrumb(itemPath, propertySchema, propertyValue),
            await this.makeForm(itemPath, propertySchema, propertyValue)
        ] };
        //return this.evaluate(methodName, itemPath, propertySchema, propertyValue);
    }

    private async checkAllowed(propertySchema: IProperty, parentPropertyValue: Item): Promise<boolean> {
        if (!propertySchema || !propertySchema.depends) { return true; }
        return parentPropertyValue ? !!evalExpr(propertySchema.depends, parentPropertyValue) : true;
    }

    private async sanitizeJson({ key, basePath, schema, model }) {
        const single = this.isSelect(schema);
        const multiple = this.isCheckBox(schema);
        const label = await this.getName(model, key, schema);
        if (multiple || single) {
            const property: IProperty = schema.items || schema;
            const dataPath = absolute(property.$data, basePath);
            let $values = [], $schema: IProperty;
            if (property.enum) {
                $values = property.enum || [];
            } else if (property.$data) {
                $values = await this.datasource.dispatch('get', dataPath) || [];
                $schema = await this.datasource.getSchema(dataPath);
                $schema = $schema.items || $schema;
            }
            const options = !property.enum? await Promise.all($values.map(async (arrayItem) => {
                return { 
                    label: (getType(arrayItem) === 'Object')? await this.getName(arrayItem, key, $schema): arrayItem,
                    value: `${dataPath}/${arrayItem._id || arrayItem}`,
                };
            })): undefined;
            const item = {
                schema: {
                    type: multiple ? "array": "string", 
                    title: label,
                    enum: options?options.map( i => i.value || i):$values,
                    description: schema.description, 
                    widget: { formlyConfig: { type: 'select', templateOptions: { label, multiple, options } } }
                },
                model: model || (multiple? []: ''),
            };
            //console.log(multiple?"checkbox": "select", basePath, JSON.stringify(item, null, 2))
            return item;

        } else if (schema.type === 'array') {
            return {
                schema: {
                    type: 'array', 
                    title: label, 
                    description: schema.description, 
                    items: {
                        type: 'object',
                        properties: { name: { type: 'string' }, path: { type: 'string' } }
                    },
                    widget: { formlyConfig: { type: schema.$widget, templateOptions: { label, path: basePath } } }
                },
                model: Array.isArray(model) ? await Promise.all(model.map(async (arrayItem, idx) => {
                        return { 
                            name: await this.getName(arrayItem, arrayItem.slug || arrayItem._id || idx, schema.items), 
                            path: `${basePath}/${arrayItem.slug || arrayItem._id || idx}` };
                })) : []
            }
        }
        if (schema.type === 'object') {
            const safeObj = {};
            const safeSchema = { 
                type: 'object', 
                title: label, 
                description: schema.description, 
                properties: {},
                widget: { formlyConfig: { type: schema.$widget, templateOptions: { label, path: basePath } } }
            };
            const properties = schema.properties ? { ...schema.properties } : {};
            if (schema.patternProperties && getType(model) === 'Object') {
                const objProperties = Object.keys(schema.properties) || [];
                // tslint:disable-next-line:no-bitwise
                const otherProperties = Object.keys(model).filter((p: string) => p[0] !== '_' && !~objProperties.indexOf(p));
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
                    const sanitized = await this.sanitizeJson({ key: prop, basePath: `${basePath}/${prop}`, schema: properties[prop], model: model[prop] || defaultValue });
                    safeSchema.properties[propKey] = {
                        ...sanitized.schema,
                        disabled: !(await this.checkAllowed(properties[prop], model))
                    };
                    safeObj[propKey] = sanitized.model; //{ ...sanitized.model, path: `${basePath}/${prop}` };
                    //if (properties[prop].$data)
                    //JSON.stringify(safeObj[propKey], null, 2), JSON.stringify(safeSchema.properties[propKey], null, 2))
                } else {
                    safeSchema.properties[prop] = properties[prop];
                    safeObj[prop] = model && model[prop];
                    //if (properties[prop].$widget) {
                        safeSchema.properties[prop] = {...safeSchema.properties[prop], 
                            widget: { formlyConfig: { type: properties[prop].$widget, templateOptions: { 
                                label: await this.getName(safeObj[prop], prop, safeSchema.properties[prop])
                            } } 
                        }};
                    //}
                    //console.log(safeSchema.properties[prop])
                }
            }
            return { schema: safeSchema, model: safeObj || {} };
        }

        return { schema, model };

    }

    private async makeForm(itemPath: string, propertySchema: IProperty, propertyValue: Item): Promise<any> {
        const pathParts = itemPath.split('/');
        const key = pathParts.length? pathParts[pathParts.length-1]: itemPath;
        const sanitized = await this.sanitizeJson({
            key, 
            basePath: itemPath,
            schema: propertySchema,
            model: propertyValue || {}
        });
        return {
            type: 'form',
            path: itemPath,
            ...sanitized
        };
    }

    private async getName(value: any, propertyNameOrIndex: string | number, propertySchema: IProperty): Promise<string> {
        let label = '';
        if (propertySchema && propertySchema.$data && typeof propertySchema.$data === 'string') {
            propertySchema = await this.datasource.getSchema(value);
            value = await this.datasource.dispatch('get', value) || '';
            return await this.getName(value, propertyNameOrIndex, propertySchema);
        }
        if (propertySchema.hasOwnProperty('$title') && value) {
            const template = Handlebars.compile(propertySchema.$title);
            label = template(value).trim();
            if (label && label.indexOf('/')) {
                label = (await Promise.all(label.split(' ').map(async labelPart => {
                    if (labelPart && labelPart.indexOf('/') > 3) {
                        //console.log(labelPart)
                        propertySchema = await this.datasource.getSchema(labelPart);
                        if (propertySchema) {
                            value = await this.datasource.dispatch('get', labelPart) || '';
                            return await this.getName(value, propertyNameOrIndex, propertySchema);
                        }    
                    }
                    return labelPart;
                }))).join(' ').trim();
            }
        } else if ((propertySchema.type === 'object' || propertySchema.type === 'array') && propertySchema.title) {
            label = propertySchema.title;
        } /* else if (propertySchema.type === 'array' && value && value.length && !propertyNameOrIndex) {
            label = (await Promise.all(value.map(async i => await this.getName(i, propertyNameOrIndex, propertySchema.items)))).join(', ');
        }*/
        if (!label) {
            label = (value && (value.title || value.name)) || propertyNameOrIndex.toString() || `[${propertySchema.type}]`;
        }
        if (label && label.length > 100) {
            label = `${label.slice(0, 97)}...`;
        }
        const result = label.replace(/([A-Z]+)/g, " $1").replace(/([A-Z][a-z])/g, " $1");
        return result.charAt(0).toUpperCase() + result.slice(1);
    }

    private isCheckBox(propertySchema: IProperty): boolean {
        if (propertySchema === undefined) { return false; };

        return propertySchema.type === 'array' &&
            this.isSelect(propertySchema.items);
    }

    private isSelect(propertySchema: IProperty): boolean {
        if (propertySchema === undefined) { return false; };

        return propertySchema.enum !== undefined || propertySchema.$data !== undefined;
    }
}
