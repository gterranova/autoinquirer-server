import { Router } from 'express';
import { Action } from 'autoinquirer/build/interfaces';
import { Dispatcher } from 'autoinquirer';

export const apiRoutes = (config: { secret: string, dispatcher: Dispatcher, autoinquirer: null }) => {
  var apiRouter = Router();
  const { dispatcher } = config;

  // Example Express Rest API endpoints
  apiRouter.use('', async (req, res, next) => {
    const action: string = (<any>{
      GET: 'get',
      POST: 'push',
      PUT: 'set',
      PATCH: 'update',
      DELETE: 'del'
    })[req.method];
    const uri = decodeURI(req.path.slice(1));
    let fn: Promise<any>;
    if (req.query.schema) {
      fn = dispatcher.getSchema(uri);
    } else {
      if (action != Action.GET) {
        await dispatcher.dispatch(action, uri, undefined, req.body);
      }
      fn = dispatcher.render(action, uri, undefined, action == 'get'? undefined: req.body);
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
