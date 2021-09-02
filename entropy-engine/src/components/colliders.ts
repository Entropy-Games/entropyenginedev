import { Component } from "../ECS/component.js"
import {v2} from "../maths/maths.js"
import {Transform} from "../index.js";

export abstract class Collider extends Component {
    // @ts-ignore
    offset: v2;
    // @ts-ignore
    solid: boolean;
    // @ts-ignore
    MatterBody: Matter.Body

    protected constructor (subtype: string, solid: boolean, offset: v2, matterBody: Matter.Body) {
        super("Collider", subtype);

        this.addPublic({
            name: 'solid',
            value: solid,
            description: 'If the collider should interact with other colliders or not',
            default: true,
            type: "boolean"
        });

        this.addPublic({
            name: 'offset',
            value: offset,
            type: 'v2',
            description: 'Offsets the renderer from the transform of the entity',
            default: v2.zero
        });

        this.MatterBody = matterBody;
    }

    abstract overlapsPoint(transform: Transform, point: v2): boolean;
}

export class CircleCollider extends Collider {
    // @ts-ignore
    radius: number;

    constructor ({
         radius = 1,
         solid = true,
         offset = new v2(0, 0),
     }) {
        super("CircleCollider", solid, offset,
            Matter.Bodies.circle(0, 0, radius, {})
        );

        this.addPublic({
            name: 'radius',
            value: radius,
            default: 1
        });
    }

    overlapsPoint(transform: Transform, point: v2): boolean {
        return point.distTo(
            transform.position.clone.v2
                .add(this.offset)
        ) <= this.radius * transform.scale.x;
    }

    json () {
        return {
            type: 'CircleCollider',
            radius: this.radius,
            solid: this.solid,
            offset: this.offset.array
        }
    }
}

export class RectCollider extends Collider {
    // @ts-ignore
    width: number;
    // @ts-ignore
    height: number;

    constructor ({ width = 1, height = 1, solid = true, offset = new v2(0, 0) }) {
        super("RectCollider", solid, offset,
            Matter.Bodies.rectangle(0, 0, width, height, {})
        );

        this.addPublic({
            name: 'height',
            value: height
        });

        this.addPublic({
            name: 'width',
            value: width
        });
    }

    overlapsPoint(transform: Transform, point: v2): boolean {
        return point.isInRect(
            transform.position.clone.v2
                .add(this.offset),
            new v2(this.width * transform.scale.x, this.height * transform.scale.y)
        );
    }

    json () {
        return {
            type: 'RectCollider',
            height: this.height,
            width: this.width,
            solid: this.solid,
            offset: this.offset.array
        }
    }
}