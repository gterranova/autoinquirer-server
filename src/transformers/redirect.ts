// tslint:disable:no-console

import { IDispatchOptions } from 'autoinquirer/build/interfaces';
import * as _ from 'lodash';

export async function redirect(_methodName: string, options?: IDispatchOptions): Promise<any> {
    if (options.query.redirectUrl)
    return { type: 'redirect', url: `http://127.0.0.1:4000/static/${options.query.redirectUrl}`, target: '_blank' };
}
