﻿import { Component } from './component.js'
import { Body} from "../components/body.js"
import {Script} from "../components/scriptComponent.js"
import {getSpriteFromJSON, setParentFromInfo} from "../JSONprocessor.js";
import { Transform } from '../components/transform.js';

export type entityConfig = {
    name: string
    components: Component[]
    tag: string | undefined
    transform: Transform
    Static: boolean
};

export class Entity {
    name: string;
    components: Component[];
    id: number;
    tag: string;
    transform: Transform;
    Static: boolean;

    constructor (config: entityConfig) {
        this.tag = config.tag ?? 'sprite';
        this.name = config.name ?? 'new entity';
        this.components = config.components ?? [];
        this.transform = config.transform ?? new Transform({})
        this.Static = config.Static ?? false

        this.id = this.generateID();
    }

    get sceneID (): number {
        let root: Transform | number = this.transform;

        while (true) {
            if (typeof root == 'number') {
                break;
            }
            root = root.parent;
        }

        return <number> root;
    }

    generateID (): number {
        let id = 0;

        let idsInUse = Entity.entities.map(sprite => sprite.id);

        function getID () {
            return Math.floor(Math.random() * 10**5);
        }

        while (idsInUse.indexOf(id) > -1)
            id = getID();

        return id;
    }

    addComponent (toAdd: Component) {
        /*
            Checks if the component is viable on the entity, and if it is not,
            then refuses to add it or overrides the problematic component.
            For example, if you try to add a rectRenderer while a CircleRenderer already exists,
            the CircleRenderer will be deleted and then the RectRenderer will be added
         */
        if (toAdd.type === 'transform') return;

        for (const component of this.components) {

            if (component.type === 'GUIElement'){
                if (toAdd.type !== 'Renderer')
                    continue;

                if (!['Renderer', 'Body', 'Camera'].includes(toAdd.type)) 
                    continue;
            }

            if (toAdd.type === 'GUIElement') {
                // favour the listed types rather than a GUIElement
                if (['Renderer', 'Body', 'Camera', 'Collider'].includes(component.type))
                    return;
            }

            if (component.type !== toAdd.type)
                continue;

            if (component.subtype !== toAdd.subtype)
                continue;
            
            // remove offending component
            this.components.splice(this.components.indexOf(component),1);
        }
        this.components.push(toAdd);
    }

    hasComponent (type: string, subType = ''): boolean {
        if (type.toLowerCase() === 'transform') return true;

        for (let c of this.components)
            if (
                (
                    c.type === type &&
                    (c.subtype === subType || subType === '')
                ) || c.subtype === type
            )
                return true;

        return false;
    }


    getComponent <Type extends Component> (type: string, subType = ''): Type {
        if (type.toLowerCase() === 'transform')
            return this.transform as unknown as Type;

        // returns the first component of passed type
        let component = this.components.find(c => (
            c.type === type &&
            (c.subtype === subType || subType === '')
        ) || c.subtype === type);

        // as scripts are going to be handled differently, check them next
        if (component === undefined)
            component = this.getComponents('Script').find(c =>
                c.subtype === subType || c.subtype === type
            )

        if (component === undefined)
            throw new Error(`Cannot find component of type ${type} on sprite ${this.name}`);

        return component as Type;
    }

    getComponents <Type extends Component> (type: string, subType=''): Type[] {
        // returns all components of that type
        let components: Type[] = [];

        for (const component of this.components)
            if (
                component.type === type &&
                (component.subtype === subType || subType === '')
            ) components.push(component as Type);

        return components;
    }

    delete () {
        for (let i = 0; i < Entity.entities.length; i++) {
            const sprite = Entity.entities[i];

            if (!Object.is(sprite, this)) continue;

            delete Entity.entities.splice(i, 1)[0];
        }
    }

    async getClone () {
        const {sprite, parentInfo} = await getSpriteFromJSON(this.json());
        setParentFromInfo(parentInfo, sprite.transform);
        return sprite;
    }

    json (): any {
        return {
            'name': this.name,
            'tag': this.tag,
            'Static': this.Static,
            'transform': this.transform.json(),
            'components': this.components.map(c => c.json())
        }
    }

    // -------------- static stuff ------------
    static entities: Entity[] = [];

    static newSprite(setup: entityConfig) {
        const newSprite = new Entity(setup);
        Entity.entities.push(newSprite);
        return newSprite;
    }

    static find (name = "") {
        const sprite = Entity.entities.find((sprite: Entity) => {
            return sprite.name === name;
        });

        if (!sprite)
            return undefined;

        return sprite as Entity;
    }

    static findWithTag (tag: string) {
        let sprites: Entity[] = [];
        Entity.loop((sprite: Entity) => {
            if (sprite.tag === tag)
                sprites.push(sprite);
        });
        return sprites;
    }

    static loop (handler: (sprite: Entity) => void) {
        for (const sprite of Entity.entities)
            handler(sprite);
    }
}