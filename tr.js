const fs = require('fs');
const babylon = require("babylon");
const traverse = require("babel-traverse").default;
const types = require("babel-types");
const generate = require("babel-generator").default;
const template = require("babel-template");

const moduleExports = template('module.exports = EXPORT;');
const requireCall = template('const ID = require(IMPORT);');
const defineCall = template('define(FUNC);');

function getFuncBody(func) {
    // func.body is block statement, so taking its body
    // TODO arrow func?
    return func.body.body;
}

function amdWithTwoArgs(ast) {
    traverse(ast, {
        CallExpression(path) {
            if (path.node.callee.name === 'define' &&
                (path.node.arguments.length == 2) &&
                types.isProgram(path.parentPath.parent)) {

                var array = path.node.arguments[0].elements; // ArrayExpression.elements
                var func = path.node.arguments[1];
                var newArs = [types.identifier('require')];

                var newBody = func.params.map((a, i) => requireCall({
                    ID: a,
                    IMPORT: array[i]
                }));

                newBody = newBody.concat(getFuncBody(func));
                newBody = types.blockStatement(newBody);

                var newFunc = types.functionExpression(null, newArs, newBody);
                var newDefine = defineCall({FUNC: newFunc});

                path.replaceWith(newDefine);
            }
        }
    });
}

function amdWithSingleArg(ast) {
    traverse(ast, {
        CallExpression(path) {
            if (path.node.callee.name === 'define' &&
                (path.node.arguments.length == 1) &&
                types.isProgram(path.parentPath.parent)) {

                var bodyPah = path.get('arguments')[0].get('body');
                bodyPah.traverse({
                    ReturnStatement(path) {
                        if (path.parentPath === bodyPah) {
                            path.replaceWith(moduleExports({
                                EXPORT: path.node.argument
                            }));
                        }
                    }
                });

                var func = path.node.arguments[0];
                var program = path.parentPath.parent;
                var newBody = program.body.reduce((acc, x) => {
                    if (x === path.parentPath.node) {
                        acc = acc.concat(getFuncBody(func));
                    } else {
                        acc.push(x);
                    }
                    return acc;
                }, []);

                program.body = newBody;
            }
        }
    });
}

function cjs(ast) {
    var imports = [];
    var exports = [];

    traverse(ast, {
        VariableDeclaration(path) {
            if (path.node.declarations.length === 1 && types.isProgram(path.getStatementParent().parentPath)) {
                var declarationPath = path.get('declarations')[0];
                var initPath = declarationPath.get('init');
                var idPath = declarationPath.get('id');

                if (types.isMemberExpression(initPath) &&
                    initPath.node.property.name === 'default' &&
                    types.isCallExpression(initPath.node.object) &&
                    initPath.node.object.callee.name === 'require') {

                    var imprt = types.importDeclaration(
                        [types.importDefaultSpecifier(idPath.node)],
                        initPath.node.object.arguments[0]);

                    imports.push(imprt);
                    path.remove();
                }

                if (types.isCallExpression(initPath) && initPath.node.callee.name === 'require') {
                    var imprt;
                    if (types.isObjectPattern(idPath)) {
                        var specifiers = idPath.get('properties').map(p => {
                            return types.importSpecifier(p.get('key').node, p.get('key').node);
                        });
                        imprt = types.importDeclaration(
                            specifiers,
                            initPath.node.arguments[0]);
                    } else {
                        imprt = types.importDeclaration(
                            [types.importDefaultSpecifier(idPath.node)],
                            initPath.node.arguments[0]);
                    }
                    imports.push(imprt);
                    path.remove();
                }
            }
        }
    });

    traverse(ast, {
        Program(path) {
            if (imports !== null) {
                var i = imports;
                imports = null; // brake recursion
                path.replaceWith(types.program(i.concat(path.node.body).concat(exports)));
            }
        }
    });
}

function transform(code) {
    const ast = babylon.parse(code);
    amdWithTwoArgs(ast);
    amdWithSingleArg(ast);
    cjs(ast);
    return generate(ast, {}, code).code;
}

fs.readdir('./tests', (err, files) => {
    files.sort().forEach(file => {
        fs.readFile('./tests/' + file, function (err, data) {
            if (err) {
              throw err;
            }
            console.log(file);
            console.log(transform(data.toString()));
            console.log('---------');
        });
    });
})
