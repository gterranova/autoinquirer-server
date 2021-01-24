import { Action } from 'autoinquirer/build/interfaces';

export const HttpMethodMap = {
    GET: Action.GET,
    POST: Action.PUSH,
    PUT: Action.SET,
    PATCH: Action.UPDATE,
    DELETE: Action.DEL
};
