import { JsonDataSource, Dispatcher } from 'autoinquirer';
import { FileSystemDataSource } from './filesystem';
import { AuthDataSource } from './auth';
import { TransparentDataSource } from './transparent';

export const proxies = [
    { name: 'Dispatcher', classRef: Dispatcher },
    { name: 'JsonDataSource', classRef: JsonDataSource },
    { name: 'FileSystemDataSource', classRef: FileSystemDataSource },
    { name: 'AuthDataSource', classRef: AuthDataSource },
    { name: 'TransparentDataSource', classRef: TransparentDataSource },    
];
