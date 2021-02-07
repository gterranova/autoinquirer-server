import { Action } from 'autoinquirer';

export const HttpMethodMap = {
    GET: Action.GET,
    POST: Action.PUSH,
    PUT: Action.SET,
    PATCH: Action.UPDATE,
    DELETE: Action.DELETE
};
