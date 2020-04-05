import { Router } from 'express';
import { Action } from 'autoinquirer/build/interfaces';
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
    let fn: Promise<any>;
    if (req.query.schema) {
      fn = renderer.getSchema({ itemPath: uri});
    } else {
      fn = renderer.render(action, { itemPath: uri, value: action == 'get'? undefined: req.body });
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
        console.log(reason);
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
