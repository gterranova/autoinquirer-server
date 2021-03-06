import { breadcrumb } from './breadcrumb';
import { template } from './custom';
import { formlyze } from './formly';
import { layout } from './layout';
import { schema } from './schema';
import { redirect } from './redirect';
import { report } from './report';
import { TransformerQuery } from './common';

export const transformers = [
    { name: TransformerQuery.BREADCRUMB, fn: breadcrumb },
    { name: TransformerQuery.TEMPLATE, fn: template },
    { name: TransformerQuery.FORMLY, fn: formlyze },
    { name: TransformerQuery.LAYOUT, fn: layout },
    { name: TransformerQuery.SCHEMA, fn: schema },
    { name: TransformerQuery.REDIRECT, fn: redirect },
    { name: TransformerQuery.REPORT, fn: report },
];

export { TransformerQuery } from './common';