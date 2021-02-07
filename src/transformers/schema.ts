import { Action, IDispatchOptions } from 'autoinquirer';

export async function schema(_methodName: Action, options?: IDispatchOptions): Promise<any> {
    return this.getSchema(options);
}
