import { breadcrumb } from './breadcrumb';
import { template } from './custom';
import { formlyze } from './formly';
import { layout } from './layout';
import { schema } from './schema';
import { redirect } from './redirect';
import { TransformerQuery } from './common';

export const transformers = [
    { name: TransformerQuery.BREADCRUMB, fn: breadcrumb },
    { name: TransformerQuery.TEMPLATE, fn: template },
    { name: TransformerQuery.FORMLY, fn: formlyze },
    { name: TransformerQuery.LAYOUT, fn: layout },
    { name: TransformerQuery.SCHEMA, fn: schema },
    { name: TransformerQuery.REDIRECT, fn: redirect },
];

export { TransformerQuery } from './common';