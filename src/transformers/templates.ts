import * as fs from 'fs';
import * as moment from 'moment';
import * as _ from 'lodash';
import * as Zip from 'adm-zip';
import { Action, IDispatchOptions } from 'autoinquirer';
const { exec } = require('child_process');
import * as Handlebars from 'handlebars';

Handlebars.registerHelper("slurp", (value, _) => {
    return (value?.fn?.(this)||value||'').toString().trim().split(/\n+/).join('\t\t');
});

Handlebars.registerHelper("lowercase", (value, _) => {
    return value?.toLowerCase() || '';
});

Handlebars.registerHelper("uppercase", (value, _) => {
    return value?.toUpperCase() || '';
});

Handlebars.registerHelper("capitalizeFirst", (value, _) => {
    return value? value.charAt(0).toUpperCase() + value.slice(1): '';
});

Handlebars.registerHelper("capitalizeEach", (value, _) => {
    return value?.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1));
});

Handlebars.registerHelper('currency', function(amount, options) {
    var num = new Number(amount);
    if (_.isNaN(num)) return '-';

    const currencyOptions = new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
    }).resolvedOptions();
    
    return num.toLocaleString('it-IT', { ...currencyOptions, style: 'decimal' });
});

Handlebars.registerHelper('eachProperty', function(context, options) {
    var ret = "";
    for(var prop in context)
    {
        ret = ret + options.fn({property:prop,value:context[prop]});
    }
    return ret;
});

Handlebars.registerHelper("link", (...args) => {
    args.pop()
    const ref = _.chain(args).compact().map( x => x.toString().trim()).join(' ').kebabCase().value();
    return `(#${ref})`;
});

Handlebars.registerHelper("ref", (...args) => {
    args.pop()
    const ref = _.chain(args).compact().map( x => x.toString().trim()).join(' ').kebabCase().value();
    return `{#${ref}}`;
});

Handlebars.registerHelper("qref", (value, _) => {
    return '{#Q'+(value||'').toString().trim()+'}';
});

Handlebars.registerHelper("setVar", function(varName, varValue, options) {
    options.data.root[varName] = varValue;
});

Handlebars.registerHelper("inc", (value, _) => {
    return parseInt(value) + 1;
});

Handlebars.registerHelper("commaAnd", (list, sep, _) => {
    if (!list || list.length == 0 ) return '';
    if (list.length == 1 ) return list;
    if (list.length == 2 ) return list[0]+sep+list[1];
    return list.slice(0, list.length-1).join(', ')+sep+list[list.length-1];
});

Handlebars.registerHelper("json", (value, _) => {
    return JSON.stringify(value||'').toString();
});

Handlebars.registerHelper("blob", (value, def, _) => {
    return value || ((typeof def === 'string')? def: "[•]");
});

Handlebars.registerHelper('ifeq', function(a, b, options) {
    return (a==b)?options.fn(this):options.inverse(this);
});

Handlebars.registerHelper('ifnz', function(a, options) {
    return (a&&parseInt(a, 10)>0)?options.fn(this):options.inverse(this);
});

Handlebars.registerHelper('ifany', function(a, options) {
    //console.log("IFANY", a);
    return a?.length>0?options.fn(this):options.inverse(this);
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
      format = DateFormats[format] || DateFormats['short'];
      return moment(datetime).format(format);
    }
    else {
      return datetime;
    }
});

async function processIncludes(content: string, dispatcher: any) {
    const regex = /\[{2}include: ([^\]]*)\]{2}$/gm;
    let remainder = content;
    let blocks = [];
    let m;

    while ((m = regex.exec(content)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === regex.lastIndex) {
            regex.lastIndex++;
        }

        // The result can be accessed through the `m`-variable.
        await Promise.all(_.map(m, async (match, groupIndex) => {
            if (groupIndex == 0) {
                blocks.push(remainder.slice(0, remainder.indexOf(match)).trim());
                remainder = remainder.slice(remainder.indexOf(match) + match.length).trim();
            }
            else {
                const reference = await dispatcher.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `${match.trim()}` });
                //console.log(match.trim(), reference);
                blocks.push(await processIncludes(reference.content, dispatcher));
            }
            return 1;
            //console.log(`Found label, group ${groupIndex}: ${match}`);                
        }));
    }
    //console.log(blocksNames)
    blocks.push(remainder);
    blocks = blocks.filter(b => b?.length != 0);
    return blocks.join('\n');
}

function processBlocks(content: string) {
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
            if (groupIndex == 0) {
                blocks.push(remainder.slice(0, remainder.indexOf(match)).trim());
                remainder = remainder.slice(remainder.indexOf(match) + match.length).trim();
            }
            else {
                blocksNames.push(match.trim());
            }
            //console.log(`Found label, group ${groupIndex}: ${match}`);                
        });
    }
    //console.log(blocksNames)
    blocks.push(remainder);
    blocks = blocks.filter(b => b.length != 0);
    return { blocks, blocksNames };
}

const partNumbering = (content: string, level = 0, prefix = '') => {
    if (level > 3) return content;
    let skips = 0;
    return content.split(RegExp(`\n[#]{${level+1}}[ ]+`, 'gm')).map((p, idx) => {
        if (p[0] == '*') { skips +=1; return p.slice(1)};
        const par = (idx-skips)>0? `${prefix}${(idx-skips).toString()}.`: '';
        return `${par} `+ partNumbering(p, level+1, par);
    }).join(_.padEnd('\n', level+2, '#')+' ').trimLeft();
}

export async function generate(data: any, options: any, dispatcher: any) { // jshint ignore:line
    //console.log(program.args, schemaFile, dataFile, options.project, options.template, options.output)

    const template = Handlebars.compile(await processIncludes(options.template, dispatcher));
    //const template = Handlebars.compile(``);

    let content = template(data);
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

    let { blocks, blocksNames } = processBlocks(content);

    options.output.path = options.output.path.replace(/\\/g, '/');
    const outputFilename = `${options.output.path}/${options.output.filename}.${blocks.length > 1?'zip':options.output.format}`;

    var zip = new Zip();
    await Promise.all(
        blocks.map( async (block, idx) => {
        const blockContent = partNumbering(block);
        let filenameFinal = outputFilename;
        if (blocks.length>1) {
            const suffix = (blocksNames[idx] || ''+idx).slice(0, 50);
            //filenameFinal = `${options.output.path}/${options.output.filename}${blocks.length>2?' '+suffix:''} (${idx+1}).${options.output.format}`
            filenameFinal = `${options.output.path}/${options.output.filename}${blocks.length>1?' '+suffix:''}.${options.output.format}`
        } 
        //console.log(`${idx}: ${blocksNames[idx]} => ${filenameFinal}`)
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
                cmd += ` --reference-doc="${options.reference}" -A "${options.reference}"`;
            } else if (options.output.format==='html') {
                cmd += ` -s --css "./pandoc.css"`;
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

                    if (blocks.length>1 && fs.existsSync(filenameFinal)) {
                        zip.addLocalFile(filenameFinal);
                    }
                    resolve(stdout.trim());
                });
            });
            if (blocks.length>1 && fs.existsSync(filenameFinal)) {
                fs.unlinkSync(filenameFinal);
            }
            if (fs.existsSync(mdFile)) {
                fs.unlinkSync(mdFile);
            }
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