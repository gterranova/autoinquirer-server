import * as fs from 'fs';
import { join, sep } from 'path';
import * as moment from 'moment';
import * as _ from 'lodash';
import * as Zip from 'adm-zip';
import { Action, IDispatchOptions } from 'autoinquirer';
const { exec } = require('child_process');
import * as Handlebars from 'handlebars';
const yaml = require('js-yaml');

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

Handlebars.registerHelper("kebabCase", (...args) => {
    args.pop()
    return _.chain(args).compact().map( x => x.toString().trim()).join(' ').kebabCase().value();
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

Handlebars.registerHelper('ifhas', function(a, b, options) {
    return _.includes(a, b)?options.fn(this):options.inverse(this);
});

Handlebars.registerHelper('ifany', function(a, options) {
    //console.log("IFANY", a);
    return a?.length>0?options.fn(this):options.inverse(this);
});

Handlebars.registerHelper('ifmore', function(a, options) {
    return a?.length>1?options.fn(this):options.inverse(this);
});

Handlebars.registerHelper('ALIST', function(a, _options) {
    if (!a) return '';
    let num = parseInt(a, 10);
    if (num===0) return '';
    return "ABCDEFGHILMNOPQRSTUVZ".slice(num-1, num);
});

Handlebars.registerHelper('roman', function(a, _options) {
    if (!a) return '';
    let num = parseInt(a, 10);
    if (num===0) return '';

    //create key:value pairs
    const romanLookup = {M:1000, D:500, C:100, L:50, X:10, V:5, I:1};
    const romanKeys = Object.keys(romanLookup);
    let roman = [];
    let curValue;
    let index;
    let count = 1;
    
    for(let numeral in romanLookup){
      curValue = romanLookup[numeral];
      index = romanKeys.indexOf(numeral);
      
      while(num >= curValue){
        
        if(count < 4){
          //push up to 3 of the same numeral
          roman.push(numeral);
        } else {
          //else we had to push four, so we need to convert the numerals 
          //to the next highest denomination "coloring-up in poker speak"
          
          //Note: We need to check previous index because it might be part of the current number.
          //Example:(9) would attempt (VIIII) so we would need to remove the V as well as the I's
          //otherwise removing just the last three III would be incorrect, because the swap 
          //would give us (VIX) instead of the correct answer (IX)
          if(roman.indexOf(romanKeys[index - 1]) > -1){
            //remove the previous numeral we worked with 
            //and everything after it since we will replace them
            roman.splice(roman.indexOf(romanKeys[index - 1]));
            //push the current numeral and the one that appeared two iterations ago; 
            //think (IX) where we skip (V)
            roman.push(romanKeys[index], romanKeys[index - 2]);
          } else {
            //else Example:(4) would attemt (IIII) so remove three I's and replace with a V 
            //to get the correct answer of (IV)
            
            //remove the last 3 numerals which are all the same
            roman.splice(-3);
            //push the current numeral and the one that appeared right before it; think (IV)
            roman.push(romanKeys[index], romanKeys[index - 1]);
          }
        }
        //reduce our number by the value we already converted to a numeral
        num -= curValue;
        count++;
      }
      count = 1;
    }
    return roman.join("").toLowerCase();
});

Handlebars.registerHelper('ownersCount', function(a, options) {
    return _.sum(a.map(h => (h.ownershipType !== 'usufruct' && h.ownershipType !== 'usufrutto')? 1: 0)).toString();
});

Handlebars.registerHelper('owners', function(a, options) {
    return a.filter(h => (h.ownershipType !== 'usufruct' && h.ownershipType !== 'usufrutto')? 1: 0);
});

Handlebars.registerHelper('hasUsufruct', function(a, options) {
    return a.filter(h => (h.ownershipType === 'usufruct' || h.ownershipType === 'usufrutto')).length > 0;
});

Handlebars.registerHelper('hasEmphyteusis', function(a, options) {
    return a.filter(h => (h.ownershipType === "enfiteusi" || h.ownershipType === "livello")).length > 0;
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

Handlebars.registerPartial('landDescr', (a, _options) => {
    const template = Handlebars.compile(`**appezzamento di terreno agricolo** esteso catastalmente **{{land.totalArea}}** ha, 
   
   {{#ifeq contratto.contractForm "private deed"}}{{else}}
   confinante nell'insieme con {{blob contratto.neighbors}};

{{/ifeq}}{{#ifmore contratto.landGroup}}{{#ifeq (ownersCount contratto.grantors) "1"}}{{else}}{{#each land.grantors as | holder |}}A. quanto a **{{holder.name}}** {{>grantorRight holder=holder}}, {{/each}}{{/ifeq}} {{/ifmore}}riportato nel **Catasto Terreni del Comune di {{land.municipality}}** al {{>landSheet .}}
`);
return template(a);
});

/*
Handlebars.registerPartial('landDescr', (a, _options) => {
    const template = Handlebars.compile(`**fondo** sito nel **Comune di {{land.municipality}}**, località {{blob ../locality}}, di circa ha **{{land.totalArea}}**, {{#ifmore contratto.landGroup}}{{#ifeq (ownersCount contratto.grantors) "1"}}{{else}}{{#each land.grantors as | holder |}}A. quanto a **{{holder.name}}** {{>grantorRight holder=holder}}, {{/each}}{{/ifeq}} {{/ifmore}}censito al **Catasto Terreni del Comune di {{land.municipality}}** al {{>landSheet .}}
   
   {{#ifeq contratto.contractForm "private deed"}}{{else}}
   confinante nell'insieme con {{blob x}};

{{/ifeq}}`);
return template(a);
});
*/

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
                const reference = await dispatcher.dispatch(Action.GET, <IDispatchOptions>{ itemPath: `${match.trim()}` }) || {};
                if (!reference.content) {
                    const localFile = join(process.cwd(), match.trim().replace('/', sep ));
                    if (fs.existsSync(localFile)) {
                        reference.content = fs.readFileSync(localFile, {encoding:'utf8', flag:'r'});
                    } else {
                        reference.content = `\n[[include: ${match}]]\n`;
                        console.log(reference.content);
                    }
                }
                //console.log(match.trim(), reference);
                blocks.push(reference.content);
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
    if (level > 3 || !content) return content || '';
    let skips = 0;
    return content.split(RegExp(`^[#]{${level+1}}[ ]+|\n[#]{${level+1}}[ ]+`, 'gm')).map((p, idx) => {
        if (p[0] == '*') { skips +=1; return  idx>0? p.slice(1): p; };
        const par = (idx-skips)>0? `${prefix}${(idx-skips).toString()}.`: '';
        return `${par} `+ partNumbering(p, level+1, par);
    }).join(_.padEnd('\n', level+2, '#')+' ').trimLeft();
}

const getParRef = (str) => {
    const regex = new RegExp('^\\{#([^\\s]*)\\}[ ]+', 'gm')
    //if (str.indexOf('(#') == 0) {
    //    console.log(str.indexOf('{#'), `"${str}"`);
    //}
    let m;
    let ref = [];

    while ((m = regex.exec(str)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === regex.lastIndex) {
            regex.lastIndex++;
        }
        
        // The result can be accessed through the `m`-variable.
        m.forEach((match, groupIndex) => {
            if (groupIndex == 1) {
                ref.push(match);
            }
        });
    }
    return ref;
}

const paragraphNumbering = (content: string, level = 0, prefix = '', refs={}) => {
    if (level > 3 || !content) return content || '';
    let skips = 0;
    let output = content.split(RegExp(`\n[\.]{${level+1}}[ ]+`, 'gm')).map((p, idx) => {
        //if (idx>0 && p[0] == '*') { skips +=1; return p.slice(1)};
        const par = (idx-skips)>0? `${prefix}${(idx-skips).toString()}`: '';
        const ref = getParRef(p);
        for (let r of ref) {
            refs[r] = refs[r]? refs[r]+par: par;
            p = p.replace(RegExp('\\{#'+r+'\\}', 'gm'), '');
        }
        return (par? `**[${par}]{#par-${_.kebabCase(par)}}.** `: '')+ paragraphNumbering(p, level+1, par+'.', refs);
    }).join('\n').trimLeft();
    // apply refs
    //if (level==0) {
        for (let k of _.keys(refs)) {
            //console.log("REPLACING", RegExp('\\[\\]\\(#'+k+'\\)', 'gm'), `[${refs[k]}](#par-${_.kebabCase(refs[k])})`)
            output = output.replace(RegExp('\\[\\]\\(#'+k+'\\)', 'gm'), `[${refs[k]}](#par-${_.kebabCase(refs[k])})`);
        }            
    //}
    return output;
}

const fixAnchors = (content: string, level = 0, prefix = '', refs={}) => {
    content = content.replace(RegExp('\\[([^\\]]+)]{\\.([^}]+)}', 'gm'), `<span class="$2">$1</span>`);
    content = content.replace(RegExp('\\[([^\\]]+)]{#([^}]+)}','gm'), `<a id=$2>$1</a>`);

    const lines = content.replace(/\r\n/gm,'\n').split('\n');
    let istable = false;
    
    return _.map(lines, (line, _idx) => {
        let out = "";
        let tstart = line.startsWith("|") && !istable, tend = !tstart && istable;
        let thead, tbody;
        if (tstart) {
            istable = thead = true;
            out += "<table class='table'><thead>";
        } 
        if ((line.startsWith("|:-") || line.startsWith("|--") || line.startsWith("+--")) && istable) {
            thead = false;
            tbody = true;
            return '</thead><tbody>';
        }
        if (line.startsWith("|") && istable) {
            line = line.slice(1);
            out += "<tr>";
            line.split('|').map( cell => {
                return out += `<${thead?"th":"td"}>\n\n${cell.trim()}\n\n</${thead?"th":"td"}>`;
            });
            out += "</tr>";
            return out;
        }
        if (istable && tend) {
            istable = tbody = false;
            return "</tbody></table>\n\n"+line;
        }    
    else return `${line}\n`;
    }).join('');
}

export const processMeta = (content) => {
    const extraDataRegexp = RegExp(/^[-]{3}\n|\n[-]{3}\n/, 'gm');
    let meta = {}, newContent = content;

    if (content.split(extraDataRegexp).length === 3) {
        const [head, extraData, tail] = content.split(extraDataRegexp);
        newContent = head + tail;
        try {
            meta = yaml.load(extraData);
        } catch (e) {
            console.log(e);
        }
    }
    return { meta, newContent };
}

export async function generate(data: any, options: any, dispatcher: any) { // jshint ignore:line
    //console.log(program.args, schemaFile, dataFile, options.project, options.template, options.output)

    let content = '', definitions = [], recursions, passes = 3;

    while (passes--) {
        content=options.template;
        const {meta, newContent} = processMeta(content);
        content = newContent;
        data = {...meta, ...data};
        recursions = 3;
        while ((~content.indexOf('[[') || ~content.indexOf('{{')) && recursions--) {
            const {meta, newContent} = processMeta(content);
            content = newContent;
            data = {...meta, ...data};
            const template = Handlebars.compile(await processIncludes(content, dispatcher));
            //console.log("Recursion", 2-recursions);
            content = template({...data, definitions});
        }
        //console.log(3-passes, "in data:", data.definitions.map(d => d.name).join().indexOf("Materiali Pericolosi"), 
        //    "has def:", definitions.map(d => d.name).join().indexOf("Materiali Pericolosi"),
        //    "in content:", content.indexOf("Materiali Pericolosi"));
        definitions = getUsedDefinitions(data, content);
    }
    // apply cross-references
    for (let def of _.orderBy(definitions, [o => o.name[0].length, o => o.name[0]], ['desc', 'desc'])) {
        for (let name of def.name) {
            //console.log(` $1[[${def.name}]{.underline}](#${_.kebabCase(def.name)})$3 `);
            content = content.replace(RegExp(`([ .,;'\(\r\n])(${name})([ .,;'\)\r\n])`, 'gm'), `$1[${name}](#${_.kebabCase(name)})$3`);            
        }        
    }

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

    if (options.output) {
        let { blocks, blocksNames } = processBlocks(content);

        options.output.path = options.output.path.replace(/\\/g, '/');
        const outputFilename = `${options.output.path}/${options.output.filename}.${blocks.length > 1?'zip':options.output.format}`;
    
        var zip = new Zip();
        await Promise.all(
            blocks.map( async (block, idx) => {
            const blockContent = partNumbering(paragraphNumbering(block));
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
    let { blocks, blocksNames } = processBlocks(content);
    if (blocks.length > 1) {
        return blocks.map( (block, idx) => {
            return `# ${blocksNames[idx]}\n\n ${partNumbering(paragraphNumbering(block))}\n\n`}).join();    
    }
    return fixAnchors(partNumbering(paragraphNumbering(blocks[0])));

}

function getUsedDefinitions(data: any, content: any) {
    //const usedDefinitions = [];
    const unusedDefinitions = [];
    const definitions = _.cloneDeep(data.definitions);
    if (data.definitions?.length) {
        for (let def of _.orderBy(definitions, [o => o.name?.[0]?.length, o => o.name?.[0]], ['desc', 'desc'])) {
            for (let name of def.name) {
                //console.log(` $1[[${def.name}]{.underline}](#${_.kebabCase(def.name)})$3 `);
                const regExp = RegExp(`([ .,;'\(\r\n])(${name})([ .,;'\)\r\n])`, 'gm');
                if (regExp.test(content)) {
                    //usedDefinitions.push(name);
                    const referenceDef = _.kebabCase(name);
                    content = content.replace(regExp, `$1[${name}](#${referenceDef})$3`);            
                } else {
                    unusedDefinitions.push(name);
                    def.name = _.difference(def.name, unusedDefinitions);
                }
            }
        }
        //console.log({unusedDefinitions});
        return _.filter(definitions, d => d.name.length);
    }
    return [];
}
