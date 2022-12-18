import { JsonDataSource, Dispatcher } from 'autoinquirer';
import { FileSystemDataSource } from './filesystem';
import { AuthDataSource } from './auth';
import { TransparentDataSource } from './transparent';
import { CMSDataSource } from './cms';

export const proxies = [
    { proxyClass: 'Dispatcher', classRef: Dispatcher },
    { proxyClass: 'JsonDataSource', classRef: JsonDataSource },
    { proxyClass: 'FileSystemDataSource', classRef: FileSystemDataSource },
    { proxyClass: 'AuthDataSource', classRef: AuthDataSource },
    { proxyClass: 'TransparentDataSource', classRef: TransparentDataSource },    
    { proxyClass: 'CMSDataSource', classRef: CMSDataSource },    
];
