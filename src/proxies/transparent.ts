import { AbstractDataSource, AbstractDispatcher, IDataSourceInfo } from 'autoinquirer';
import { Action, IDispatchOptions, IProperty } from 'autoinquirer';


export class TransparentDataSource extends AbstractDispatcher {
    cache = {};
    schemaCache = {};

    public async connect(parentDispatcher: AbstractDispatcher) {
        this.setParent(parentDispatcher);
    }
    public async close() {
    }
    public async report(_options?: IDispatchOptions): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public async get(_options?: IDispatchOptions): Promise<any> {
        throw new Error('Method not implemented.');
    }
    public async dispatch(methodName: Action, options?: IDispatchOptions) {
        const { parentPath, itemPath} = options;
        const newPath = [parentPath, itemPath].filter( p => p?.length).join('/');
        if (methodName === Action.GET) {
            this.cache[newPath] = this.cache[newPath] || await this.parentDispatcher.getDataSource().dispatch(methodName, { ...options, itemPath: newPath, parentPath: '' });
            return this.cache[newPath];
        } else {
            this.cache[newPath] = null;
        }
        //console.log(`[${methodName.toUpperCase()}]: ${newPath}`);
        return await this.parentDispatcher.getDataSource().dispatch(methodName, { ...options, itemPath: newPath, parentPath: '' });
    }
    public async isMethodAllowed(_methodName: Action, _options?: IDispatchOptions): Promise<Boolean> {
        return true;
    }
    public async getSchema(options?: IDispatchOptions): Promise<IProperty> {
        //console.log("getSchema", options)
        const { parentPath, itemPath} = options;
        const newPath = [parentPath, itemPath].filter( p => p?.length).join('/');
        //console.log( {newPath, parent: !!(parentDispatcher||options.params?.parent) })
        try {
            this.schemaCache[newPath] = this.schemaCache[newPath] || await this.parentDispatcher.getSchemaDataSource().get({ ...options, itemPath: newPath });
        } catch {
            this.schemaCache[newPath] = {};
        }
        return this.schemaCache[newPath];
    }
    public getDataSource(): AbstractDataSource {
        return this.parentDispatcher.getDataSource();
    }
    public getSchemaDataSource(): AbstractDataSource {
        return { ...this, get: (options) => this.getSchema(options) };
    }

    public async getDataSourceInfo(options?: IDispatchOptions): Promise<IDataSourceInfo<AbstractDataSource>> {
        const itemPath = [options.parentPath, options.itemPath].filter( p => p?.length).join('/');
        
        return { dataSource: this.parentDispatcher, entryPointOptions: {...options, itemPath, parentPath: null} };
    }
}
