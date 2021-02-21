import * as express from 'express';
import { join, dirname } from 'path';
import * as fs from 'fs';

import * as bodyParser from 'body-parser';
import * as logger from 'morgan';
import * as cors from 'cors';
import * as expressJwt from 'express-jwt';
//import { adminRoutes } from './admin';
//import { authRoutes } from './auth';
import { apiRoutes } from './api';

//import { uploadRoutes } from './upload';
//import { contactsRoutes } from './contacts';
//import { generateSitemap } from './sitemap';
import * as SocketIO from 'socket.io';
import { Dispatcher } from 'autoinquirer';
import { transformers } from './transformers';
import { proxies } from './proxies';

var program = require('commander');

// Express server
async function main(schemaFile, dataFile) { // jshint ignore:line
  // jshint ignore:line
  const app = express();
  const http = require('http');
  const server = http.createServer(app) // io requires raw http
  const io = SocketIO(server) // Setup Socket.io's server
  const PORT = process.env.PORT || 4000;
  const DIST_FOLDER = join(process.cwd(), 'dist', 'browser');
  process.chdir(dirname(schemaFile));
  const PUBLIC_FOLDER = join(process.cwd(), 'public');

  const renderer = new Dispatcher(schemaFile, dataFile);
  renderer.registerProxies(proxies);
  renderer.registerTransformers(transformers);
  
  //renderer.registerProxy('filesystem', new FileSystemDataSource(DIST_FOLDER));
  await renderer.connect(null); // jshint ignore:line

  //const autoinquirer = new AutoInquirer(config.dispatcher);

  app.use(
    cors({
      credentials: true
    })
  );
  app.use(bodyParser.json({ strict: false }));
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(logger('dev'));
  app.use(
    expressJwt({
      secret: 'secret',
      algorithms: ['HS256'],
      credentialsRequired: false
    }).unless({path: ['/auth/login']}),
    function (err, req, res, next) {
      if (err.code === 'invalid_token') return next();
      return next(err);
    }
  );

  // Catch all other routes and return the index file
  //app.use('/admin', adminRoutes(ADMIN_FOLDER));
  //app.use('/auth', authRoutes(config));
  //app.use('/contacts', contactsRoutes());

  // Example Express Rest API endpoints
  //app.use('/api/files', uploadRoutes(UPLOAD_FOLDER));
  /*
  io.on("connection", (socket) => {
    autoinquirer.on('prompt', prompt => {
        //console.log('Prompt: ' + JSON.stringify(prompt));
        socket.broadcast.emit("prompt", prompt);
    });
    autoinquirer.on('error', state => { 
        socket.broadcast.emit('error', state)
    });
    autoinquirer.on('exit', state => socket.broadcast.emit('exit', state));
    autoinquirer.on('complete', () => config.dispatcher.close() );
    socket.on('answer', (data) => {
      //console.log('Answer: ' + JSON.stringify(data));
      autoinquirer.onAnswer(data).then(() => autoinquirer.run());
    });
    autoinquirer.run();
  });
  */
  // Server static files from /browser
  app.use(
    '/public',
    (req, res) => {
      //console.log(decodeURIComponent(req.url))
      res.sendFile(join(PUBLIC_FOLDER, decodeURIComponent(req.url)));
    }
  );

  app.use('/api', apiRoutes(renderer));

  // Server static files from /browser
  app.get(
    '*.*',
    express.static(DIST_FOLDER, {
      maxAge: '1y'
    })
  );

  // All regular routes use the Universal engine
  app.get('*', (req, res) => {
    res.sendFile(join(DIST_FOLDER, 'index.html'));
  });

  // Start up the Node server
  server.listen(PORT, () => {
    console.log(`Node Express server listening on http://localhost:${PORT}`);
  });

}

function isDir(path) {
  try {
      return fs.lstatSync(path).isDirectory();
  } catch (e) {
      // lstatSync throws an error if path doesn't exist
      return false;
  }
}

program
  .version('1.0.0')
  .description('JSON API Server')
  .arguments('[directory]')
  .option('-s, --schema [schemaFile]', 'Schema', 'schema.json')
  .option('-d, --data [dataFile]', 'Data', 'data.json')
  .parse(process.argv);

if (!program.args[0] || isDir(program.args[0])) {
  main(join(program.args[0] || '.', program.schema), join(program.args[0] || '.', program.data));
} else {
  program.outputHelp();
}

process.on('unhandledRejection', (err: Error) => {
  //console.log('An unhandledRejection occurred');
  //console.log(`Rejected Promise: ${p}`);
  console.log(err.stack || err.toString());
  // dispatcher.close();
});
