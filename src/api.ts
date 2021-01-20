import { Router } from 'express';
import { Action, IDispatchOptions } from 'autoinquirer/build/interfaces';
import { FormlyRenderer } from './formlybuilder';

export const apiRoutes = (renderer: FormlyRenderer) => {
  var apiRouter = Router();

  // Example Express Rest API endpoints
  apiRouter.use('', async (req, res, next) => {
    const action: string = (<any>{
      GET: Action.GET,
      POST: Action.PUSH,
      PUT: Action.SET,
      PATCH: Action.UPDATE,
      DELETE: Action.DEL
    })[req.method];
    const uri = decodeURI(req.path.slice(1));
    const user = (<any>req).user?.uid ? await renderer.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `/auth/users/${(<any>req).user.uid}` }) : null;
    let fn: Promise<any>;
    if (req.query.schema) {
      fn = renderer.getSchema({ itemPath: uri});
    } else if (action === Action.GET && req.query.render) {
      fn = renderer.render(action, <IDispatchOptions>{ itemPath: uri, value: undefined, query: req.query, user });
    } else if (action === Action.GET && req.query.sanitize) {
      fn = renderer.sanitize(action, <IDispatchOptions>{ itemPath: uri, value: undefined, query: req.query, user });
    } else {
      fn = renderer.dispatch(action, <IDispatchOptions>{ itemPath: uri, value: req.body, query: req.query, user });
    } 
    
    try {
      return fn.then((data: any)=> {
        if (!data) {
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
