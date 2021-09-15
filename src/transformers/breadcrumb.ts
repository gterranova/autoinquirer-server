// tslint:disable:no-console

import { Action, IDispatchOptions } from 'autoinquirer';
import * as _ from 'lodash';
import { decode } from 'html-entities';
import { getName, fullPath } from './common';

export async function breadcrumb(_methodName: Action, options?: IDispatchOptions): Promise<any> {
    const parts = options.itemPath.split('/');
    //const { dataSource } = <IDataSourceInfo<AbstractDataSource>>await this.getDataSourceInfo({ itemPath: options.itemPath });
    const path = parts[parts.length-1];
    const [cursor, pathParts] = await Promise.all([
        this.convertObjIDToIndex(options),
        Promise.all( parts.map( async (_p, idx) => {
            const value = fullPath(options.parentPath, parts.slice(0, idx+1).join('/'), options.params?.archived);
            //const { entryPointInfo } = await this.getDataSourceInfo({ itemPath: value });
            return { value, label: decode((await getName(this, {itemPath: value })).trim()) };
        }))
    ]);
    return { type: 'breadcrumb', user: _.omit(options.user, 'password'), pathParts, ...cursor };
}

