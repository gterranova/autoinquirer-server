import * as fs from 'fs';
import * as _ from 'lodash';
import * as moment from 'moment';
import * as Handlebars from 'handlebars';
import { resolve } from 'path';
import * as Zip from 'adm-zip';
const { exec } = require('child_process');

import { Action, IDispatchOptions } from 'autoinquirer/build/interfaces';

Handlebars.registerHelper("inc", (value, _) => {
    return parseInt(value) + 1;
});

Handlebars.registerHelper("commaAnd", (list, sep, _) => {
    if (!list || list.length == 0 ) return '';
    if (list.length == 1 ) return list;
    return list.slice(0, list.length-1).join(', ')+sep+list[list.length-1];
});

Handlebars.registerHelper("json", (value, _) => {
    return JSON.stringify(value||'').toString();
});

Handlebars.registerHelper("blob", (value, _) => {
    return value || "[•]";
});

Handlebars.registerHelper('ifeq', function(a, b, options) {
    return (a==b)?options.fn(this):options.inverse(this);
});

Handlebars.registerHelper('ifmore', function(a, options) {
    return a?.length>1?options.fn(this):options.inverse(this);
});

Handlebars.registerHelper('ownersCount', function(a, options) {
    return _.sum(a.map(h => h.ownershipType !== 'usufruct'? 1: 0)).toString();
});

Handlebars.registerHelper('owners', function(a, options) {
    return a.filter(h => h.ownershipType !== 'usufruct'? 1: 0);
});


Handlebars.registerPartial('parcelDescr', (a, _options) => {
    const template = Handlebars.compile('**{{parcel}}**, {{#each portions as | portion |}}{{#if portion.name}}Porz. {{portion.name}} {{/if}}{{portion.quality}}, cl. {{portion.classe}}, ha {{portion.area}}, R.D. {{portion.rd}}, R.A. {{portion.ra}}{{#if @last}}{{else}}, {{/if}}{{/each}}');
    return template(a);
});

Handlebars.registerPartial('parcelsDescr', (a, _options) => {
    const more = a.parcelsGroup?.length>1;
    const template = Handlebars.compile('{{#each parcelsGroup as | parcel |}}{{#ifmore ../parcelsGroup}}- {{/ifmore}}{{>parcelDescr parcel}};\n{{/each}}');
    return template({...a, more});
});

Handlebars.registerPartial('landSheet', (a, _options) => {
    const template = Handlebars.compile(`**foglio {{sheet}}** {{#ifmore parcelsGroup}}particelle:
{{else}}particella{{/ifmore}}
   {{>parcelsDescr .}}`);
    return template(a);
});

const DateFormats = {
    short: "DD/MM/YYYY",
    long: "dddd DD.MM.YYYY"
};

// Use UI.registerHelper..
Handlebars.registerHelper("formatDate", function(datetime, format) {
    if (moment) {
      // can use other formats like 'lll' too
      format = DateFormats[format] || format;
      return moment(datetime).format(format);
    }
    else {
      return datetime;
    }
});

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
    return _.uniq(items);
}

function holdersKey(o: any) {
    return o.holders && o.holders.length && 
        _.sortBy(o.holders, 'name').map( h => [h.name, h.quota, h.ownershipType]).join(' ')
}

function holdersKeyOwnership(o: any) {
    return o.holders && o.holders.length && 
        _.sortBy(o.holders, 'name').filter(h => ['property', 'bare ownership'].indexOf(h.ownershipType) !== -1)
            .map( h => [h.name, h.quota]).join(' ');
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
    return obj.map((land) => {
        if (typeof land == 'string') {
            const projectPath = land.split('/').slice(2)
            return _.values(lookupValues(projectPath, data))[0];
        }
        return land;
    });
}

function resolveRegistrations(obj: any, data: any) {
    if (!obj) return [];
    return _.chain(obj.map((land) => land.registrations || [])).flatten().map( reg => {
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
        if (o.prices !== undefined) {
            if (o.prices[kind+'Type'] === 'per hectar') {
                return o.prices[kind] * (o.portions? sumPortionsAreas(o.portions) : areaToFloat(o[key]));
            } else {
                return o.prices[kind];
            }
        }
        //console.log("no price for", o)
        return 0;
    }));
}

function groupLandsBySheet(landsGroup: any[], data: any) {
    return _.chain(landsGroup)
        .groupBy('sheet')
        .values()
        .filter( o => o !== undefined && o.length && o[0] !== undefined)
        .map((lands) => {
            //console.log(lands)
            return { 
                sheet: lands[0].sheet, 
                holders: resolveHolders(lands[0].holders, data),
                municipality: lands[0].municipality, 
                parcels: _.sortBy(_.map(lands, (o) => o.parcel), (i) => _.toNumber(i)),
                parcelsGroup: lands,
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
                return o.sheet+holdersKey({ holders });
            } catch {
                //console.log(o);
            }
            return ''
        })
        .values()
        .filter( o => o !== undefined && o.length && o[0] !== undefined)
        .map((lands) => {
            //console.log(lands)
            return { 
                sheet: lands[0].sheet, 
                holders: resolveHolders(lands[0].holders, data),
                municipality: lands[0].municipality, 
                parcels: _.sortBy(_.map(lands, (o) => o.parcel), (i) => _.toNumber(i)),
                parcelsGroup: lands,
                totalArea: sumLandsAreas(lands)
            }
        })
        .value();
}
function groupByOwnersAndSheet(data: any) {
    return _.chain(lookupValues('lands/0', data))
        .values()
        //.map( (o) => _.pick(o, ['sheet', 'parcel', 'holders']))
        .groupBy(holdersKeyOwnership)
        .values()
        .map( (landsGroup) => {
            const allHolders = _.chain(landsGroup).filter(l => l.holders?.length ).map(l => l.holders).flatten().uniqBy(h => ''+h.name+h.ownershipType+h.taxcode).value();
            const holders = resolveHolders(allHolders, data);
            const lands = _.sortBy(groupLandsBySheetAndOwnership(landsGroup, data), (i) => _.toNumber(i.sheet));
            const grantors = _.uniqBy(holders, h => ''+h.name+h.taxcode);
            const municipalities = _.uniq(_.values(lands).map( o => o.municipality ));
            const totalPrice = new Intl.NumberFormat('it-IT', {
                style: 'decimal',
                minimumFractionDigits: 2
              }).format(sumLandsPrices(_.flatten(landsGroup), 'area', 'price'));

            const area = sumLandsAreas(lands, 'totalArea');

            //console.log("totalprice", totalPrice, area, 45000*areaToFloat(area))
            const registrations = _.chain(resolveRegistrations(landsGroup, data))
                .map( (registration) => {
                    //registration.holder = resolveHolder(registration.holder, data);
                    const regLandsGroup = resolveLands(registration.lands, data);
                    //registration.lands = groupLandsBySheet(regLandsGroup);
                    return {...registration, lands: groupLandsBySheet(regLandsGroup, data)};
                })
                .uniqBy( reg => ''+reg.transcriptionRegPart+reg.transcriptionRegGen)
                .filter( reg => /CONTRO/.exec(reg.transcriptionType) && reg.applicable)
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
                grantors,
                holders,
                municipalities,
                registrations,
                totalArea: sumLandsAreas(lands, 'totalArea'),
                depositPerHectar: new Intl.NumberFormat('it-IT', {
                    style: 'decimal',
                    minimumFractionDigits: 2
                  }).format(landsGroup[0].prices?.depositType==='per hectar'?landsGroup[0].prices.deposit: 0),
                pricePerHectar: new Intl.NumberFormat('it-IT', {
                    style: 'decimal',
                    minimumFractionDigits: 2
                  }).format(landsGroup[0].prices?.priceType==='per hectar'?landsGroup[0].prices.price: 0),
                totalDeposit: new Intl.NumberFormat('it-IT', {
                    style: 'decimal',
                    minimumFractionDigits: 2
                  }).format(sumLandsPrices(landsGroup, 'area', 'deposit')),
                totalPrice
            };
        })
        .value();

}

function groupByChallengeableOwnersAndSheet(data: any) {
    return _.chain(lookupValues('lands/0', data))
        .values()
        .map( (o) => {
            return {...o, holders: _.filter(o.holders, (h) => h.titleChallengeableWithin && _.toNumber(h.titleChallengeableWithin)>=2020)};
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

const lands = (data: any) => {
    const allLand = _.cloneDeep(groupBySheet(_.cloneDeep(data)));
    const landsGroups = groupByOwnersAndSheet(_.cloneDeep(data));
    const challengeableGroups = groupByChallengeableOwnersAndSheet(_.cloneDeep(data));
    //resolveMacroareas(data);

    return {
        municipalities: municipalities(_.cloneDeep(data)),
        allLand,
        landsGroups, 
        challengeableGroups,
        totalArea: sumLandsAreas(landsGroups, 'totalArea'),
        registrations: registrations(_.cloneDeep(data)),
        allRegistrations: _.groupBy(registrations(_.cloneDeep(data), true), 'name'),
        constraints: constraints(_.cloneDeep(data))
    }
}

async function generate(data: any, options: any) { // jshint ignore:line
    //console.log(program.args, schemaFile, dataFile, options.project, options.template, options.output)

    const template = Handlebars.compile(options.template);
    //const template = Handlebars.compile(``);

    const definitions = _.chain(options.definitions).split(' ').map(d => d.split('=').map( d => d.trim())).fromPairs().value();
    const content = template({..._.cloneDeep(data), ...lands(_.cloneDeep(data)), ...definitions});
    const regex = /\-{5} block: ([^-]*)\-{5}$/gm;
    let remainder = content;
    let blocks = [];
    let blocksNames = [];
    let m;

    while ((m = regex.exec(content)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === regex.lastIndex) {
            regex.lastIndex++;
        }
        
        // The result can be accessed through the `m`-variable.
        m.forEach((match, groupIndex) => {
            if (groupIndex==0) {
                blocks.push(remainder.slice(0, remainder.indexOf(match)).trim());
                remainder = remainder.slice(remainder.indexOf(match)+match.length).trim();
            }
            else {
                blocksNames.push(match.trim());
            }
            //console.log(`Found label, group ${groupIndex}: ${match}`);                
        });
    }
    //console.log(blocksNames)
    blocks.push(remainder);
    blocks = blocks.filter( b => b.length != 0);

    options.output.path = options.output.path.replace(/\\/g, '/');
    const outputFilename = `${options.output.path}/${options.output.filename}.${blocks.length > 1?'zip':options.output.format}`;

    var zip = new Zip();
    await Promise.all(
        blocks.map( async (blockContent, idx) => {
        let filenameFinal = outputFilename;
        if (blocks.length>1) {
            const suffix = blocksNames[idx] || ''+idx;
            filenameFinal = `${options.output.path}/${options.output.filename}${blocks.length>2?' '+suffix:''} (${idx++}).${options.output.format}`
        } 
        const toc = options.toc?'--toc':'';

        if (options.output.format==='md') {
            fs.writeFileSync(filenameFinal, blockContent);
            if (blocks.length>1) {
                zip.addLocalFile(filenameFinal);
                fs.unlinkSync(filenameFinal);
            }
    
        } else if (options.output.format!=='md') {
            const mdFile = filenameFinal.replace(`.${options.output.format}`, '.md');
            fs.writeFileSync(mdFile, blockContent);
            //const cmd = `pandoc "${mdFile}" -f markdown+pipe_tables --columns=43 --toc --wrap=preserve -t docx --reference-doc=${options.reference} -A ${options.reference} -o "${filenameFinal}"`;
            let cmd = `pandoc "${mdFile}" -f markdown+pipe_tables --columns=43 ${toc} --wrap=preserve -t ${options.output.format} -o "${filenameFinal}"`;
            if (options.output.format==='docx') {
                cmd += ` --reference-doc=${options.reference} -A ${options.reference}`;
            } else {
                cmd += ' -s';
            }
            //console.log(cmd)
            const result = await new Promise(function(resolve, reject) {
                exec(cmd, (error, stdout) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    if (blocks.length>1) {
                        zip.addLocalFile(filenameFinal);
                    }
                    resolve(stdout.trim());
                });
            });
            if (blocks.length>1) {
                fs.unlinkSync(filenameFinal);
            }
            fs.unlinkSync(mdFile);
            //console.log(result);
        }
    }));
    //console.log(blocks.length)
    if (blocks.length>1) {
        zip.writeZip(outputFilename);
    }
    return outputFilename.slice(options.output.path.length+1);
    //if (blocks.length>0) {
    //    console.log(Object.keys(blocks))
    //}
}

export async function template(methodName: string, options?: IDispatchOptions): Promise<any> {
    options = options || {};
    options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
    options.schema = options?.schema || await this.getSchema(options);
    options.value = options?.value || await this.dispatch(methodName, options);

    if (options.value.template) {
        const template = await this.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `${options.value.template}` });
        const generatedFilename = await generate(options.value, { 
            template: template.content, 
            reference: resolve(process.cwd(), template.reference),
            toc: template.toc || false,
            output: {
                path: resolve(process.cwd(), 'static'),
                filename: `${template.title}_${options.value.name}`, 
                format: template.format || 'docx'
            }
            });
        return { type: 'redirect', url: `http://127.0.0.1:4000/static/${generatedFilename}`, target: '_blank' };    
    }
}
