import { join } from 'path';
import { Dispatcher, JsonSchema, DataSource } from 'autoinquirer';
import { FileSystemDataSource } from './filesystem';
import { DataRenderer } from 'autoinquirer/build/datasource';

const DIST_FOLDER = join(process.cwd(), '../');

export const createDatasource = async function (
  schemaFile: string | JsonSchema,
  dataFile: string | DataSource,
  renderer?: DataRenderer
): Promise<Dispatcher> {
  // jshint ignore:line

  const dispatcher = new Dispatcher(schemaFile, dataFile, renderer);
  dispatcher.registerProxy('filesystem', new FileSystemDataSource(DIST_FOLDER));
  await dispatcher.connect(); // jshint ignore:line
  return dispatcher;
};
