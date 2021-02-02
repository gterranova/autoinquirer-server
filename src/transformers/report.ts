import * as fs from 'fs';
import * as _ from 'lodash';
import * as moment from 'moment';
import * as Handlebars from 'handlebars';

import { getName } from './common';

import { join, resolve } from 'path';
import * as Zip from 'adm-zip';
const { exec } = require('child_process');

import { Action, IDispatchOptions } from 'autoinquirer/build/interfaces';

Handlebars.registerHelper("slurp", (value, _) => {
    return (value||'').toString().trim().split(/\n+/).join('\t\t');
});

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
    if (moment && datetime) {
      // can use other formats like 'lll' too
      format = DateFormats[format] || DateFormats['short'];
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

function resolveContratti(obj: any, data: any) {
    if (!obj) return [];
    return _.chain(obj).map((contratto) => {
        if (typeof contratto == 'string') {
            return _.values(lookupValues(contratto, data))[0];
        }
        return contratto;
    }).orderBy('data').value();
}

function commesse(data: any) {
    return _.chain(lookupValues('commesse/0', data))
        .values()
        .orderBy('data')
        //.map( (o) => _.pick(o, ['sheet', 'parcel', 'holders']))
        .map( (commessa) => {
            const contratti = resolveContratti(commessa.contratti, data);
            return {
                ...commessa,
                contratti, 
            };
        })
        .value();

}

const ddr = (data: any) => {
    return {
        commesse: commesse(_.cloneDeep(data)),
    }
}

async function generate(data: any, options: any) { // jshint ignore:line
    //console.log(program.args, schemaFile, dataFile, options.project, options.template, options.output)

    const template = Handlebars.compile(options.template);
    //const template = Handlebars.compile(``);

    const definitions = _.chain(options.definitions).split(' ').map(d => d.split('=').map( d => d.trim())).fromPairs().value();
    let content = template({..._.cloneDeep(data), ...ddr(_.cloneDeep(data)), ...definitions});

    // Try to fix tables
    content = content.split('\n').map( line => {
        if (line[0] === '|' && line.indexOf('\t\t') !== -1) {
            let baseArray = line.split(/ *\| */).map( v => v.split(/\t+/) );
            const maxRows = _.chain(baseArray).map('length').max().value(); 
            baseArray = _.chain(baseArray).map( x => { const o = x.length; x.length = maxRows; return _.fill(x, '', o) }).value();
            const alen = baseArray.map(ll => _.max(ll.map(l => l.length)));
            baseArray = baseArray.map((ll,idx) => ll.map(l => _.padEnd(l, alen[idx])))
            return _.zip(...baseArray).map(x=>x.join(' | ').trim()).join('\n');
        }
        return line;
    }).join('\n');

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
            //fs.unlinkSync(mdFile);
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

export async function report(methodName: string, options?: IDispatchOptions): Promise<any> {
    options = options || {};
    options.itemPath = options?.itemPath ? await this.convertPathToUri(options.itemPath) : '';
    options.schema = options?.schema || await this.getSchema(options);
    options.value = options?.value || await this.dispatch(methodName, options);

    if (options.value.template) {
        const template = await this.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `${options.value.template}` });
        const reference = await this.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `${template.reference}` });
        const referenceFilename = resolve(process.cwd(), join(reference.dir, reference.name));
        const generatedFilename = await generate(options.value, { 
            template: template.content, 
            reference: referenceFilename,
            toc: template.toc || false,
            output: {
                path: resolve(process.cwd(), 'public'),
                filename: `${template.title}_${await getName(this, options)}`, 
                format: template.format || 'docx'
            }
            });
        return { type: 'redirect', url: `http://127.0.0.1:4000/public/${generatedFilename}`, target: '_blank' };    
    }
}
