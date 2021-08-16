import * as _ from 'lodash';

import { getName } from './common';

import { join, resolve } from 'path';
import { Action, IDispatchOptions } from 'autoinquirer';
import { generate } from './templates';

export const lookupValues = (schemaPath: string | string[] = '', obj: any, currPath: string = ''): any => {
    const parts = typeof schemaPath === 'string' ? schemaPath.split('/') : schemaPath;
    const key = parts[0];
    const converted = currPath.split('/');
    let output = {};
    if (Array.isArray(obj)) {
        obj.map( (itemObj: any) => {
            if (itemObj && (RegExp(key).test(itemObj._id) || key === itemObj.slug)) {
                const devPath = [...converted, itemObj._id];
                output = {...output, ...lookupValues(parts.slice(1), itemObj, devPath.join('/'))};
            }; 
        });
    } else if (obj[key]) {
        converted.push(key);
        return lookupValues(parts.slice(1), obj[key], converted.join('/'));
    } else if (parts.length == 0) {
        //console.log("FOUND?", obj);
        return { [converted.join('/').replace(/^\//,'')]: obj };
    }
    return output;    
}

function resolveComments(obj: any, data: any) {
    if (!obj) return [];
    return _.chain(obj).map((comment) => {
        if (typeof comment == 'string') {
            return _.values(lookupValues(comment, data))[0];
        }
        return comment;
    }).value();
}

function resolveContratti(obj: any, data: any) {
    if (!obj) return [];
    return _.chain(obj).map((contratto) => {
        if (typeof contratto == 'string') {
            const datiContratto = _.values(lookupValues(contratto, data))[0];
            return {
                ...datiContratto,
                commenti: datiContratto?.commenti && resolveComments(datiContratto.commenti, data), 
            };
        }
        return contratto;
    }).orderBy('data').value();
}

function resolveATI(obj: any, data: any) {
    if (!obj) return;
    const item = _.values(lookupValues(obj, data))[0];
    return {
        ...item,
        commenti: item?.commenti && resolveComments(item.commenti, data), 
    };
}

function commesse(data: any) {
    return _.chain(lookupValues('commesse/0', data))
        .values()
        .orderBy('data')
        //.map( (o) => _.pick(o, ['sheet', 'parcel', 'holders']))
        .map( (commessa) => {
            const contratti_attivi = resolveContratti(commessa.contratti_attivi, data);
            const contratti_passivi = resolveContratti(commessa.contratti_passivi, data);
            const fideiussioni = resolveContratti(commessa.fideiussioni, data);
            const ati = resolveATI(commessa.ati, data);
            return {
                ...commessa,
                contratti_attivi, 
                contratti_passivi,
                fideiussioni,
                ati,
            };
        })
        .value();

}

function affidamenti(data: any) {
    return _.chain(data.affidamenti).map( aff => {
        return { denominazione: aff.denominazione, fideiussioni: _.chain(aff.fideiussioni)
        .orderBy(['scadenza'])
        //.map( (o) => _.pick(o, ['sheet', 'parcel', 'holders']))
        .map( (fideiussione) => {
            const commessa = _.values(lookupValues(fideiussione.commessa, data))[0];
            return {
                ...fideiussione,
                commessa
            };
        })
        .groupBy('banca'/*o => moment(o.scadenza).format('YYYY') */)
        .value() };
    }) 
}

function ati(data: any) {
    return _.chain(lookupValues('ati/0', data))
        .values()
        .orderBy(['data'])
        //.map( (o) => _.pick(o, ['sheet', 'parcel', 'holders']))
        .map( (ati) => {
            const commessa = _.values(lookupValues(ati.commessa, data))[0];
            return {
                ...ati,
                commessa
            };
        })
        .value();

}

function domande(data: any) {
    return _.chain(lookupValues('qa/0', data))
        .values()
        .orderBy('numero')
        .map( (domanda) => {
            const commessa = _.values(lookupValues(domanda.commessa, data))[0];
            const contratto_attivo = _.values(lookupValues(domanda.contratto_attivo, data))[0];
            const contratto_passivo = _.values(lookupValues(domanda.contratto_passivo, data))[0];
            return {
                ...domanda,
                commessa,
                contratto_attivo, 
                contratto_passivo,
            };
        })
        .groupBy(o => o.commessa? `${o.commessa.commessa} - ${o.commessa.riferimento}`: "ALTRE COMMESSE")
        .value();

}

const ddr = (data: any) => {
    return {
        commesse: commesse(_.cloneDeep(data)),
        domande: domande(_.cloneDeep(data)),
        affidamenti: affidamenti(_.cloneDeep(data)),
        ati: ati(_.cloneDeep(data)),
    }
}

export async function report(methodName: Action, options?: IDispatchOptions): Promise<any> {
    options = options || {};
    options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
    options.schema = options?.schema || await this.getSchema(options);
    options.value = options?.value || await this.dispatch(methodName, options);

    if (options.value.template) {
        const template = await this.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `${options.value.template}` });
        const reference = await this.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `${template.reference}` });
        const referenceFilename = resolve(process.cwd(), join(reference.path, reference.name));
        const data = {..._.cloneDeep(options.value), ...ddr(_.cloneDeep(options.value)) /*, ...definitions*/}

        const generatedFilename = await generate(data, { 
            template: template.content, 
            reference: referenceFilename,
            toc: template.toc || false,
            output: {
                path: resolve(process.cwd(), 'public'),
                filename: `${template.title}_${await getName(this, options)}`, 
                format: template.format || 'docx'
            }
            }, this);
        return { type: 'redirect', url: `http://127.0.0.1:4000/public/${generatedFilename}`, target: '_blank' };    
    }
}
