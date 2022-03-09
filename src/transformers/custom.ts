import * as _ from 'lodash';
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


export const municipalities = (data: any) => {
    const items = _.values(lookupValues('lands/0/municipality', data));
    //console.log(items);
    items.push(data.municipality);
    return _.compact(_.uniq(items));
}

function holdersKey(o: any) {
    if (o.holders && o.holders.length)
        return _.sortBy(o.holders, 'name')
            .map( h => [o.section || 'default', h.name, h.quota, h.ownershipType, h.titleChallengeableWithin])
            .join(' ')
    return o.section || 'default';
}

function holdersKeyOwnership(o: any) {
    if (o.holders && o.holders.length)
        return _.sortBy(o.holders, 'name') //.filter(h => ['property', 'bare ownership'].indexOf(h.ownershipType) !== -1)
            .map( h => {
                //console.log([o.section || 'default', h.name, h.quota, h.ownershipType]);
                return [o.section || 'default', h.name, h.quota, h.ownershipType];
        }).join(' ');
    return o.section || 'default';
}

function resolveHolder(holderPath: string, data: any) {
    if (!holderPath) return {};
    const projectPath = holderPath.split('/').slice(2);
    const value = _.values(lookupValues(projectPath, data));
    return value.length ? value[0].info : {};
}

function resolveMacroareas(data: any) {
    data.redflag.overview.map((item) => {
        //console.log(item)
        Object.assign(item, _.values(lookupValues(item.key.split('/').slice(2), data))[0]);
    })
}

function resolveHolders(obj: any, data: any) {
    if (!obj) return [];
    obj.map((holder) => {
        const holderData = resolveHolder(holder.name, data);
        Object.assign(holder, holderData)
    })
    return obj;
}

function resolveLands(obj: any, data: any) {
    if (!obj) return [];
    return _.chain(obj).map((land) => {
        if (typeof land == 'string') {
            const projectPath = land.split('/').slice(2)
            return _.values(lookupValues(projectPath, data))[0];
        }
        return land;
    })
    .orderBy(o => o? _.padStart(o.municipality, 25, ' ')+_.padStart(o.sheet, 6, '0')+_.padStart(o.parcel, 6, '0'): '')
    .value();
}

function resolveRegistrations(obj: any, data: any) {
    if (!obj) return [];
    return _.chain(obj.map((land) => land?.registrations || [])).flatten().map( reg => {
        //console.log(reg);
        const projectPath = reg.split('/').slice(2)
        return _.values(lookupValues(projectPath, data))[0];
    }).value();
}

function areaToFloat(area: string): number {
    if (!area) return 0;
    const [centiare, are , hectars] = _.map(area.split('.').reverse(), _.toNumber);
    return  (centiare / 10000 + are / 100 + hectars);
}

function areaToString(area: number): string {
    if (!area) return '00.00.00';
    let parts = []; 
    let total = area;
    let last;
    for (let x of [0, 1, 2]) {
        last = Math.trunc(total+0.00001);
        //console.log(area, x, last)
        parts.push(_.padStart(last.toString(), 2, '0'));
        total = (total - last)*100;
    }
    return  parts.join('.');
}

function sumPortionsAreas(portions: any[]): number {
    return _.sum(_.map(portions, (o) => areaToFloat(o.area)));
}

function sumLandsAreas(lands: any[], key: string = 'area'): string {
    return areaToString(_.sum(_.map(lands, (o) => o.portions ? sumPortionsAreas(o.portions) : areaToFloat(o[key]))));
}

function sumLandsPrices(lands: any[], key: string = 'area', kind: string = 'price'): number {
    return _.sum(_.map(lands, (o) => {
        const area = o.portions? sumPortionsAreas(o.portions) : areaToFloat(o[key]);
        return _sumLandsPrices(o, area, kind);
    }));
}

function _sumLandsPrices(o: any, area: number, kind: string = 'price'): number {
    if (o.prices !== undefined) {
        if (o.prices[kind+'Type'] === 'per hectar') {
            return o.prices[kind] * area;
        } else {
            return o.prices[kind];
        }
    }
    //console.log("no price for", o)
    return 0;
}

function groupLandsBySheet(landsGroup: any[], data: any) {
    return _.chain(landsGroup)
        .orderBy(o => _.padStart(o.municipality, 25, ' ')+_.padStart(o.sheet, 6, '0')+_.padStart(o.parcel, 6, '0'))
        .groupBy(o => _.padStart(o.municipality, 25, ' ')+_.padStart(o.sheet, 6, '0'))
        .values()
        .filter( o => o !== undefined && o.length && o[0] !== undefined)
        .map((lands) => {
            //console.log(lands)
            return { 
                sheet: lands[0].sheet, 
                holders: resolveHolders(lands[0].holders, data),
                municipality: lands[0].municipality, 
                parcels: _.sortBy(_.map(lands, (o) => o.parcel), (i) => _.toNumber(i)),
                parcelsGroup: _.sortBy(lands, (l) => _.toNumber(l.parcel)),
                totalArea: sumLandsAreas(lands)
            }
        })
        .value();
}

function groupLandsBySheetAndOwnership(landsGroup: any[], data: any) {
    return _.chain(landsGroup)
        .groupBy(o => {
            try {
                const holders = resolveHolders(o.holders, data);
                //console.log(_.padStart(o.sheet, 6, '0')+holdersKey({ ...o, holders }))
                return _.padStart(o.sheet, 6, '0')+holdersKey({ ...o, holders });
            } catch {
                //console.log(o);
            }
            return ''
        })
        .values()
        .filter( o => o !== undefined && o.length && o[0] !== undefined)
        .map((lands) => {
            //console.log("AREA", sumLandsAreas(lands), lands)
            return { 
                sheet: lands[0].sheet, 
                section: lands[0].section, 
                holders: resolveHolders(lands[0].holders, data),
                municipality: lands[0].municipality, 
                parcels: _.sortBy(_.map(lands, (o) => o.parcel), (i) => _.toNumber(i)),
                parcelsGroup: _.sortBy(lands, (l) => _.toNumber(l.parcel)),
                totalArea: sumLandsAreas(lands),
                notarialReports: lands[0].notarialReports,
                CDUs: lands[0].CDUs
            }
        })
        .orderBy( o => _.toNumber(o.sheet) )
        .value();
}
function groupByOwnersAndSheet(data: any) {
    return _.chain(lookupValues('lands/0', data))
        .values()
        //.map( (o) => _.pick(o, ['sheet', 'parcel', 'holders']))
        .orderBy(o => o.section+_.padStart(o.municipality, 25, ' ')+_.padStart(o.sheet, 6, '0')+_.padStart(o.parcel, 6, '0'))
        .groupBy(holdersKeyOwnership)
        .values()
        .map( (landsGroup) => {
            const allHolders = _.chain(landsGroup).filter(l => l?.holders?.length ).map(l => l.holders).flatten().value();
            const holders = _.uniqBy(resolveHolders(allHolders, data), h => ''+h.name+h.quota+h.ownershipType+h.taxcode);
            const lands = _.sortBy(groupLandsBySheetAndOwnership(landsGroup, data), o => _.padStart(o.municipality, 25, ' ')+_.padStart(o.sheet, 6, '0')+_.padStart(o.parcel, 6, '0'));
            const grantors = _.uniqBy(holders, h => ''+h.name+h.taxcode);
            const municipalities = _.compact(_.uniq(_.values(lands).map( o => o.municipality )));
            const challengeableHolders = _.filter(holders, h => h.titleChallengeableWithin && _.toNumber(h.titleChallengeableWithin)>=2021);
            //if (challengeableHolders.length) console.log(challengeableHolders)
            const totalPrice = landsGroup[0].prices?.price>0 ?new Intl.NumberFormat('it-IT', {
                style: 'decimal',
                minimumFractionDigits: 2
              }).format(sumLandsPrices(_.flatten(landsGroup), 'area', 'price')): 0;

            const area = sumLandsAreas(lands, 'totalArea');

            //console.log("totalprice", totalPrice, area, 45000*areaToFloat(area))
            const registrations = _.chain(resolveRegistrations(landsGroup, data))
                .filter()
                .map( (registration) => {
                    //registration.holder = resolveHolder(registration.holder, data);
                    const regLandsGroup = resolveLands(registration.lands, data);
                    //registration.lands = groupLandsBySheet(regLandsGroup);
                    return {...registration, lands: groupLandsBySheet(regLandsGroup, data)};
                })
                .uniqBy( reg => ''+reg.transcriptionRegPart+reg.transcriptionRegGen)
                .filter( reg => /*/CONTRO/.exec(reg.transcriptionType) &&*/ reg.applicable)
                .map( reg => {
                    reg.transcriptionType = reg.transcriptionType.toLowerCase().split(' ')[0];
                    reg.deedType = reg.deedType.toLowerCase();
                    reg.officer = reg.officer?.trim().toLowerCase().replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())));
                    if (reg.holder && typeof reg.holder == 'string') {
                        reg.holder = resolveHolder(reg.holder, data)
                    }
                    reg.name = (reg.holder?.name || reg.name).trim().toLowerCase().replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())));
                    reg.deedDescr = reg.deedDescr.toLowerCase(); //?.trim().toLowerCase().replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())));
                    //console.log(reg.title);                    
                    return reg;
                })
                .value();

            return {
                lands, 
                section: landsGroup[0].section||'',
                grantors,
                holders,
                municipalities,
                registrations,
                challengeableHolders,
                totalArea: sumLandsAreas(lands, 'totalArea'),
                depositPerHectar: landsGroup[0].prices?.deposit>0 ? new Intl.NumberFormat('it-IT', {
                    style: 'decimal',
                    minimumFractionDigits: 2
                }).format(landsGroup[0].prices?.depositType==='per hectar'?landsGroup[0].prices.deposit: 0): 0,
                extensionPricePerHectar: landsGroup[0].prices?.extensionPrice>0 ? new Intl.NumberFormat('it-IT', {
                    style: 'decimal',
                    minimumFractionDigits: 2
                  }).format(landsGroup[0].prices?.extensionPriceType==='per hectar'?landsGroup[0].prices.extensionPrice: 0): 0,
                pricePerHectar: landsGroup[0].prices?.price>0 ?new Intl.NumberFormat('it-IT', {
                    style: 'decimal',
                    minimumFractionDigits: 2
                  }).format(landsGroup[0].prices?.priceType==='per hectar'?landsGroup[0].prices.price: 0): 0,
                totalDeposit: landsGroup[0].prices?.deposit>0 ? new Intl.NumberFormat('it-IT', {
                    style: 'decimal',
                    minimumFractionDigits: 2
                  }).format(sumLandsPrices(landsGroup, 'area', 'deposit')): 0,
                totalExtensionPrice: landsGroup[0].prices?.extensionPrice>0 ? new Intl.NumberFormat('it-IT', {
                    style: 'decimal',
                    minimumFractionDigits: 2
                  }).format(sumLandsPrices(landsGroup, 'area', 'extensionPrice')): 0,
                totalPrice
            };
        })
        .value();

}

function groupByChallengeableOwnersAndSheet(data: any) {
    return _.chain(lookupValues('lands/0', data))
        .values()
        .orderBy(o => _.padStart(o.municipality, 25, ' ')+_.padStart(o.sheet, 6, '0')+_.padStart(o.parcel, 6, '0'))
        .map( (o) => {
            return {...o, holders: _.filter(o.holders, (h) => h.titleChallengeableWithin && _.toNumber(h.titleChallengeableWithin)>=2021)};
         })
        .groupBy(holdersKey)
        .values()
        .map( (landsGroup) => {
            return _.chain(landsGroup[0].holders)
                .groupBy( (h) => [h.ownershipType, h.ownershipOrigin, h.titleChallengeableWithin ].join(' '))
                .values()
                .map( (ownersByTitle) => {
                    //console.log(ownersByTitle)
                    const holders = resolveHolders(ownersByTitle, data);
                    const lands = groupLandsBySheet(landsGroup, data);
                    return {
                        lands, 
                        holders,
                        totalArea: sumLandsAreas(lands, 'totalArea')
                    };    
                })
                .value();
        })
        .flatten()
        .value();

}

function groupBySheet(data: any) {
    return groupLandsBySheet(_.values(lookupValues('lands/0', data)), data);
}

function registrations(data: any, includeAll: boolean = false) {
    return _.chain(lookupValues('registrations/0', data))
        .values()
        .filter( (o) => o.applicable || includeAll)
        .map( (registration) => {
            const landsGroup = resolveLands(registration.lands, data);
            registration.holder = resolveHolder(registration.holder, data);
            const lands = groupLandsBySheet(landsGroup, data);
            return { ...registration, lands };
        })
        .value();

}

function constraints(data: any) {
    return _.chain(lookupValues('constraints/0', data))
        .values()
        //.map( (o) => _.pick(o, ['sheet', 'parcel', 'holders']))
        .map( (registration) => {
            const landsGroup = resolveLands(registration.lands, data);
            const lands = groupLandsBySheet(landsGroup, data);
            return {
                ...registration,
                lands, 
                //holders: resolveHolders(landsBySheet[_.keys(landsBySheet)[0]][0].holders, data),
                //totalArea: areaToString(_.sum(_.map(lands, (o) => areaToFloat(o.totalArea))))
            };
        })
        .value();

}

function notarialReports(data: any) {
    return _.chain(lookupValues('notarialReports/0', data))
        .values()
        .sortBy("date")
        //.map( (o) => _.pick(o, ['sheet', 'parcel', 'holders']))
        .map( (rnv) => {
            const landsGroup = resolveLands(rnv.lands, data);
            const lands = groupLandsBySheet(landsGroup, data);
            return {
                ...rnv,
                lands, 
                //holders: resolveHolders(landsBySheet[_.keys(landsBySheet)[0]][0].holders, data),
                //totalArea: areaToString(_.sum(_.map(lands, (o) => areaToFloat(o.totalArea))))
            };
        })
        .value();
}

function CDUs(data: any) {
    return _.chain(lookupValues('CDUs/0', data))
        .values()
        .sortBy("date")        
        //.map( (o) => _.pick(o, ['sheet', 'parcel', 'holders']))
        .map( (cdu) => {
            const landsGroup = resolveLands(cdu.lands, data);
            const lands = groupLandsBySheet(landsGroup, data);
            return {
                ...cdu,
                lands, 
                //holders: resolveHolders(landsBySheet[_.keys(landsBySheet)[0]][0].holders, data),
                //totalArea: areaToString(_.sum(_.map(lands, (o) => areaToFloat(o.totalArea))))
            };
        })
        .value();
}

const lands = (data: any) => {
    const allLand = _.cloneDeep(groupBySheet(_.cloneDeep(data)));
    const landsGroups = groupByOwnersAndSheet(_.cloneDeep(data));
    const challengeableGroups = groupByChallengeableOwnersAndSheet(_.cloneDeep(data));
    //resolveMacroareas(data);

    return {
        municipalities: municipalities(_.cloneDeep(data)),
        allLand,
        landsGroups, 
        sections: _.chain(landsGroups).map(l => l.section).uniq().value(),
        challengeableGroups,
        totalArea: sumLandsAreas(landsGroups, 'totalArea'),
        registrations: registrations(_.cloneDeep(data)),
        allRegistrations: _.groupBy(registrations(_.cloneDeep(data), true), 'name'),
        constraints: constraints(_.cloneDeep(data)),
        notarialReports: notarialReports(_.cloneDeep(data)),
        CDUs: CDUs(_.cloneDeep(data))
    }
}

const contracts = (data: any) => {
    return { contracts: _.chain(data.contracts).map( contract => {
        const lands = resolveLands(contract.lands, data);
        const landGroup = _.sortBy(groupLandsBySheetAndOwnership(lands, data), o => _.padStart(o.municipality, 25, ' ')+_.padStart(o.sheet, 6, '0')+_.padStart(o.parcel, 6, '0'));
        const grantors = _.map(contract.grantors, grantor => resolveHolder(grantor, data));

        const allHolders = _.chain(lands).filter(l => l?.holders?.length ).map(l => l.holders).flatten().value();
        const holders = _.uniqBy(resolveHolders(allHolders, data), h => ''+h.name+h.quota+h.ownershipType+h.taxcode);
        const challengeableHolders = _.filter(holders, h => h.titleChallengeableWithin && _.toNumber(h.titleChallengeableWithin)>=2021);

        const registrations = _.chain(resolveRegistrations(lands, data))
        .map( (registration) => {
            //registration.holder = resolveHolder(registration.holder, data);
            const regLandsGroup = resolveLands(registration.lands, data);
            //registration.lands = groupLandsBySheet(regLandsGroup);
            return {...registration, lands: groupLandsBySheet(regLandsGroup, data)};
        })
        .uniqBy( reg => ''+reg.transcriptionRegPart+reg.transcriptionRegGen)
        .filter( reg => /*/CONTRO/.exec(reg.transcriptionType) &&*/ reg.applicable)
        .map( reg => {
            reg.transcriptionType = reg.transcriptionType.toLowerCase().split(' ')[0];
            reg.deedType = reg.deedType.toLowerCase();
            reg.officer = reg.officer?.trim().toLowerCase().replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())));
            if (reg.holder && typeof reg.holder == 'string') {
                reg.holder = resolveHolder(reg.holder, data)
            }
            reg.name = (reg.holder?.name || reg.name).trim().toLowerCase().replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())));
            reg.deedDescr = reg.deedDescr.toLowerCase(); //?.trim().toLowerCase().replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())));
            //console.log(reg.title);                    
            return reg;
        })
        .value();

        const totalArea = areaToString(_.sum(_.map(landGroup, (o) => areaToFloat(o.totalArea))));
        const totalPrice = contract.prices?.price>0 ?new Intl.NumberFormat('it-IT', {
            style: 'decimal',
            minimumFractionDigits: 2
          }).format(_sumLandsPrices(contract, areaToFloat(totalArea), 'price')): 0;
        const totalDeposit = contract.prices?.price>0 ?new Intl.NumberFormat('it-IT', {
            style: 'decimal',
            minimumFractionDigits: 2
        }).format(_sumLandsPrices(contract, areaToFloat(totalArea), 'deposit')): 0;
        const totalExtensionPrice = contract.prices?.price>0 ?new Intl.NumberFormat('it-IT', {
            style: 'decimal',
            minimumFractionDigits: 2
        }).format(_sumLandsPrices(contract, areaToFloat(totalArea), 'extensionPrice')): 0;

        return { 
            ...contract, 
            landGroup, 
            grantors, 
            totalArea, 
            totalPrice, totalDeposit, totalExtensionPrice,
            challengeableHolders,
            registrations,
        }
    }).value() }
}

const documents = (data: any) => {
    const authorizationDocuments = _.orderBy(data.authorizationDocuments, o => [o.data, o.titolo]);
    const sezioni = _.chain(authorizationDocuments || []).map(d => d.sezione).uniq().value();
    return {
        sezioni,
        authorizationDocuments
    }
}

export async function template(methodName: Action, options?: IDispatchOptions): Promise<any> {
    options = options || {};
    options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
    options.schema = options?.schema || await this.getSchema(options);
    options.value = options?.value || await this.dispatch(methodName, options);

    if (options.value.template) {
        const template = await this.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `${options.value.template}` });
        const reference = await this.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `${template.reference}` });
        const referenceFilename = resolve(process.cwd(), join(reference.path, reference.name));
        //const definitions = _.chain(options.definitions).split(' ').map(d => d.split('=').map( d => d.trim())).fromPairs().value();
        const data = {..._.cloneDeep(options.value), ...documents(_.cloneDeep(options.value)), ...lands(_.cloneDeep(options.value)), ...contracts(_.cloneDeep(options.value)) /*, ...definitions*/}
        const generatedFilename = await generate(data, { 
            template: template.content, 
            reference: referenceFilename,
            toc: template.toc || false,
            output: {
                path: resolve(process.cwd(), 'public'),
                filename: `${template.title}_${options.value.name}`, 
                format: template.format || 'docx'
            }
            }, this);
        return { type: 'redirect', url: `http://127.0.0.1:4000/public/${generatedFilename}`, target: '_blank' };    
    }
}
