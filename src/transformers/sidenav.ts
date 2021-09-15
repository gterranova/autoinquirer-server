// tslint:disable:no-console

import { Action, IDispatchOptions } from 'autoinquirer';
import * as _ from 'lodash';
import { getName, fullPath } from './common';

export async function sidenav(_methodName: Action, options?: IDispatchOptions): Promise<any> {
    const schema = await this.getSchema({ itemPath: '' });
    const value = options?.value || await this.dispatch(Action.GET, {...options, schema, itemPath: '' });

    if (!options.schema) {
        //console.log(options)
        throw new Error("Schema cannot be null");
    }
    const itemPromise = Promise.all(_.map(_.isArray(value)? value: [value], async item => {
        const keys = Promise.all(
            _.chain(item)
            .keys()
            .filter( k => _.isObject(item[k]) && schema.properties?.[k])
            .map( async k => {
                const resolver = async (schema, path) => {
                    const opt ={...options, schema: schema.properties[k], itemPath: path };
                    //console.log(opt)
                    return { 
                        title: await getName(this, opt), 
                        path: '/'+path
                    }    
                };
                return resolver(schema, k)
            })
            .value()
        );
        return keys;
    }));
    const items = _.flatten(await itemPromise);
    return { type: 'sidenav', title: await getName(this, options), user: _.omit(options.user, 'password'), items };
}

