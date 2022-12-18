import { Router } from 'express';
import { Action, IDispatchOptions } from 'autoinquirer';
import { Dispatcher } from 'autoinquirer';
import { HttpMethodMap } from './constants';
import { IncomingForm } from 'formidable';
import { join } from 'path';

export const apiRoutes = (renderer: Dispatcher) => {
  var apiRouter = Router();

  apiRouter.use('', async (req, res, next) => {
    if (req.method.toLowerCase() !== 'post' || !req.headers['content-type'].startsWith('multipart/form-data')) {
      return next();
    }

    // parse a file upload
    let form = new IncomingForm();
  
    /**
     * Options
     */
    form = Object.assign(form, {
      multiples: true,
      keepExtensions: true,
      encoding: 'utf-8',
      type: 'multipart', // or urlencoded
      maxFieldsSize: 20 * 1024 * 1024, // default = 20 * 1024 * 1024 = 20mb
      maxFields: 1000, // Max files & fields - default = 1000
      hash: false, // sha1, md5 or false
    });
    //console.log(req.method.toLowerCase(), req.body);
    (<any>req).files = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) {
          return reject(err);
        }
        resolve(files);
      });
    }).catch((reason: any) => {
      console.error(reason);
      res.statusCode = 400;
      return res.send(reason);
    });
    return next();
  });

  apiRouter.post('/json-rpc' , async (req, res, next) => {
    const { jsonrpc, method, params, id } = req.body;
    if (jsonrpc !== '2.0' || !method || !params?.path || !id) {
      return res.json({jsonrpc: '2.0', id, error: { code: 400, message: 'Malformed RPC request' }});
    }
    const uri = decodeURI(params.path.slice(1));
    const user = (<any>req).user?.uid ? await renderer.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `auth/users/${(<any>req).user.uid}` }) : null;
    const reqTransformer = req.query['do'] && Array.isArray(req.query['do']) ? req.query['do'][0] : req.query['do'];
    const transformer = renderer.getTransformer(reqTransformer.toString()) || renderer.dispatch.bind(renderer);
    const value = (Object.keys(params.value || {}).length>0 && params.value) || undefined;
    const files = (<any>req).files;
    const fn = transformer(method, <IDispatchOptions>{ itemPath: uri, value, query: req.query, files, user });
    const responseObj = {jsonrpc, id };
    try {
      return fn.then((data: any)=> {
        if (data === undefined || data === null) {
          res.statusCode = 404;
          res.json({...responseObj, error: { code: res.statusCode, message: 'Resource not found' }});
        } else {
          res.json({...responseObj, result: data })
        }
      }).catch((reason: any) => {
        console.error(reason);
        res.statusCode = 400;
        res.json({...responseObj, error: { code: res.statusCode, message: reason }});
      });  
    } catch {
      res.statusCode = 500;
      res.json({...responseObj, error: { code: res.statusCode, message: 'Server Error' }});
    }
  });

  // Example Express Rest API endpoints
  apiRouter.use('', async (req, res, next) => {
    const action: string = HttpMethodMap[req.method];
    const uri = decodeURI(req.path.slice(1));
    const user = (<any>req).user?.uid ? await renderer.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `auth/users/${(<any>req).user.uid}` }) : null;
    const reqTransformer = req.query['do'] && Array.isArray(req.query['do']) ? req.query['do'][0] : req.query['do'];
    const transformer = renderer.getTransformer(reqTransformer.toString()) || renderer.dispatch.bind(renderer);
    const value = Object.keys(req.body).length>0 && req.body;
    const files = (<any>req).files;
    const fn = transformer(action, <IDispatchOptions>{ itemPath: uri, value, query: req.query, files, user });
    try {
      return fn.then((data: any)=> {
        if (data === undefined || data === null) {
          res.statusCode = 404;
          res.send();
        } else {
          res.json(data)
        }
      }).catch((reason: any) => {
        console.error(reason);
        res.statusCode = 400;
        res.send(reason);
      });  
    } catch {
      res.statusCode = 500;
      res.send({ error: "Server error"});
    }
  });
  return apiRouter;
};
