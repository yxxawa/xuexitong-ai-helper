"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Project = void 0;
class Project {
    constructor({ name, domains, scripts }) {
        this.name = name;
        this.domains = domains;
        for (const key in scripts) {
            if (Object.prototype.hasOwnProperty.call(scripts, key)) {
                const element = scripts[key];
                element.projectName = name;
            }
        }
        this.scripts = scripts;
    }
    static create(opts) {
        return new Project(opts);
    }
}
exports.Project = Project;
