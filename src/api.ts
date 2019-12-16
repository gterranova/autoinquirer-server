import { Router } from 'express';

export const apiRoutes = config => {
  var apiRouter = Router();
  const { dispatcher } = config;

  // Example Express Rest API endpoints
  apiRouter.use('', (req, res, next) => {
    const action = {
      GET: 'get',
      POST: 'push',
      PUT: 'set',
      PATCH: 'update',
      DELETE: 'del'
    }[req.method];
    const uri = decodeURI(req.path.slice(1));
    let fn;
    if (req.query.schema) {
      fn = dispatcher.getSchema(uri);
    } else {
      fn = dispatcher.dispatch(action, uri, undefined, req.body);
    }
    console.log(action, uri)
    try {
      return fn.then(data => {
        if (!data) {
          res.statusCode = 404;
          res.send();
        } else {
          res.json(data)
        }
      }).catch(reason => {
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
