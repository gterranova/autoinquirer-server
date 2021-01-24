// tslint:disable:no-console

import { IDispatchOptions } from 'autoinquirer/build/interfaces';
import * as _ from 'lodash';
import { TransformerQuery } from './common';

export async function layout(methodName: string, options?: IDispatchOptions): Promise<any> {
    options = options || {};
    options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
    options.schema = options?.schema || await this.getSchema(options);
    options.value = options?.value || await this.dispatch(methodName, options);

    if (options.query.template) return await this.getTransformer(TransformerQuery.REDIRECT)(methodName, options);
    options.value = undefined;

    return { 
        type: 'layout', 
        children: await Promise.all([
            //await this.makeAuth(options),
            this.getTransformer(TransformerQuery.BREADCRUMB)(methodName, options),
            this.getTransformer(TransformerQuery.FORMLY)(methodName, options)
        ])
    };
    //return this.evaluate(methodName, itemPath, schema, value);
}

