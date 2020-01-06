import { join } from 'path';
import { Dispatcher } from 'autoinquirer';
import { FileSystemDataSource } from './filesystem';

const DIST_FOLDER = join(process.cwd(), '../');

export const createDatasource = async function (
  schemaFile,
  dataFile,
  renderer?
) {
  // jshint ignore:line

  const dispatcher = new Dispatcher(schemaFile, dataFile, renderer);
  dispatcher.registerProxy('filesystem', new FileSystemDataSource(DIST_FOLDER));
  await dispatcher.connect(); // jshint ignore:line
  return dispatcher;
};
