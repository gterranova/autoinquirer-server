// tslint:disable:no-console

import { Action, IDispatchOptions } from 'autoinquirer';
import * as _ from 'lodash';
import { TransformerQuery } from './common';

export async function layout(methodName: Action, options?: IDispatchOptions): Promise<any> {
    options = options || {};
    if (/^archived\/?/.test(options.itemPath)) {
        options.itemPath = options.itemPath.replace(/^archived\/?/, '');
        options.params = {...options.params, archived: true };
    }
    if (options.params?.archived && methodName !== Action.GET) 
        throw new Error(`Method ${methodName} not implemented for archived items`);

    options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
    options.schema = options?.schema || await this.getSchema(options);
    options.value = options?.value || await this.dispatch(methodName, options);

    if (options.query.template) return await this.getTransformer(TransformerQuery.REDIRECT)(methodName, options);
    options.value = undefined;

    return { 
        type: 'sidenav',
        ...await this.getTransformer(TransformerQuery.SIDENAV)(methodName, options),
        children: [{
            type: 'layout', 
            children: await Promise.all([
                //await this.makeAuth(options),
                this.getTransformer(TransformerQuery.BREADCRUMB)(methodName, options),
                this.getTransformer(TransformerQuery.FORMLY)(methodName, options)
            ])    
        }]
    };
    //return this.evaluate(methodName, itemPath, schema, value);
}

