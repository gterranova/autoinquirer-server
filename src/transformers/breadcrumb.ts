// tslint:disable:no-console

import { IDispatchOptions } from 'autoinquirer/build/interfaces';
import * as _ from 'lodash';
import { decode } from 'html-entities';
import { getName } from './common';

export async function breadcrumb(_methodName: string, options?: IDispatchOptions): Promise<any> {
    const parts = options.itemPath.split('/');
    const { dataSource } = await this.getDataSourceInfo({ itemPath: options.itemPath });
    const path = parts[parts.length-1];
    const [cursor, pathParts] = await Promise.all([
        dataSource.convertObjIDToIndex(path, options.itemPath.slice(0, options.itemPath.length - path.length)),
        Promise.all( parts.map( async (_p, idx) => {
            const value = parts.slice(0, idx+1).join('/');
            const { entryPointInfo } = await this.getDataSourceInfo({ itemPath: value });
            return { value, label: decode((await getName(this, {itemPath: value, parentPath: entryPointInfo?.parentPath })).trim()) };
        }))
    ]);
    return { type: 'breadcrumb', pathParts, ...cursor };
}

