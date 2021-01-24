import { Router } from 'express';
import { Action, IDispatchOptions } from 'autoinquirer/build/interfaces';
import { Dispatcher } from 'autoinquirer';
import { HttpMethodMap } from './constants';

export const apiRoutes = (renderer: Dispatcher) => {
  var apiRouter = Router();

  // Example Express Rest API endpoints
  apiRouter.use('', async (req, res, next) => {
    const action: string = HttpMethodMap[req.method];
    const uri = decodeURI(req.path.slice(1));
    const user = (<any>req).user?.uid ? await renderer.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `/auth/users/${(<any>req).user.uid}` }) : null;
    const reqTransformer = req.query['do'] && Array.isArray(req.query['do']) ? req.query['do'][0] : req.query['do'];
    const transformer = renderer.getTransformer(reqTransformer) || renderer.dispatch.bind(renderer);
    const value = Object.keys(req.body).length>0 && req.body;

    const fn = transformer(action, <IDispatchOptions>{ itemPath: uri, value, query: req.query, user });
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
