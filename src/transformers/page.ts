// tslint:disable:no-console

import { Action, IDispatchOptions } from 'autoinquirer';
import * as _ from 'lodash';
import { TransformerQuery } from './common';
import { generate } from './templates';
import { salepurchase, project } from './custom';

export async function page(methodName: Action, options?: IDispatchOptions): Promise<any> {
    options = options || {};
    if (options.itemPath && /^archived\/?/.test(options.itemPath)) {
        options.itemPath = options.itemPath.replace(/^archived\/?/, '');
        options.params = {...options.params, archived: true };
    }
    if (options.params?.archived && methodName !== Action.GET) 
        throw new Error(`Method ${methodName} not implemented for archived items`);

    options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
    options.schema = options?.schema || await this.getSchema(options);
    options.value = options?.value || await this.dispatch(methodName, options);

    let content, data;
    if (options.value.template) {
        const template = await this.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `${options.value.template}` });
        data = options.itemPath.startsWith('spa')? await salepurchase(options.value, this): await project(options.value, this);
        content = await generate(data, { template: template.content }, this);

    } else if (options.value.content) {
        content = await generate({}, { template: options.value.content }, this);
    }
    return { 
        ...await this.getTransformer(TransformerQuery.SIDENAV)(methodName, {itemPath: ''}),
        children: [{
            type: 'layout', 
            children: await Promise.all([
                //await this.makeAuth(options),
                this.getTransformer(TransformerQuery.BREADCRUMB)(methodName, options),
                Promise.resolve({ type: 'markdown', content }),
            ])
        }]
    };
}

