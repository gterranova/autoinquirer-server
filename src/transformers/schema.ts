import { IDispatchOptions } from 'autoinquirer/build/interfaces';

export async function schema(_methodName: string, options?: IDispatchOptions): Promise<any> {
    return this.getSchema(options);
}
