import React, { useState, useMemo } from "react";
import { scaleSqrt, scaleLinear, ScaleLinear } from "d3-scale";
import { primary } from "../theme";

import arrow from "viz-annotation/lib/Connector/end-arrow";
import { TrimmedDataNode, Edge } from "../types";

type Props = {
  selected: string;
  directories: string[];
  directoryColors: { [key: string]: string };
  max?: number;
  changeSelected: React.Dispatch<string | undefined>;
  nodes: TrimmedDataNode[];
  edges: Edge[];
};

type InOut = "in" | "out";

const OFFSET = 100;

interface NodeWithPosition extends TrimmedDataNode {
  x: number;
  y: number;
  r: number;
  degrees: number | undefined;
}

function mapLocation(
  radiusScale: ScaleLinear<number, number>,
  inOrOut: InOut,
  files: TrimmedDataNode[],
  rOffset = OFFSET
) {
  let translateX = 0,
    translateY = 150,
    maxX = 0,
    minR = OFFSET;

  let total = 0;
  const requires = files
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .map((d, i) => {
      const spacing = Math.max(radiusScale(d.totalBytes) * 2, 0);
      const value = {
        ...d,
        r: radiusScale(d.totalBytes),
        spacing,
        offset: total + spacing / 2
      };

      total += value.spacing;

      return value;
    });

  const rSize = Math.max(minR, (total * 2.4) / 2 / Math.PI);
  if (rSize > minR) {
    minR = rSize;
  }
  const circumfrence = 2 * Math.PI * rSize;

  const overallArcStart = (total / circumfrence / 2) * 360;

  const center = inOrOut === "in" ? 270 : 90;
  const sign = inOrOut === "in" ? 1 : -1;

  const angleScale = scaleLinear()
      .domain([0, total || 0])
      .range([
        center + overallArcStart * sign,
        center - overallArcStart * sign
      ]),
    yScale = (degrees: number, r: number) =>
      -Math.cos(degrees * (Math.PI / 180)) * r,
    xScale = (degrees: number, r: number) =>
      Math.sin(degrees * (Math.PI / 180)) * r;

  const nodesWithPosition = requires.map(d => {
    const degrees = angleScale(d.offset);
    const node: NodeWithPosition = {
      ...d,
      x: xScale(degrees, rSize) + sign * (rSize - rOffset),
      y: yScale(degrees, rSize),
      r: radiusScale(d.totalBytes),
      degrees: undefined
    };

    if (-(node.x + node.r) > translateX) translateX = -(node.x + node.r);
    if (node.y > translateY) translateY = node.y;
    if (node.x > maxX) maxX = node.x;
    node.degrees = degrees;

    return node;
  });

  return { nodesWithPosition, x: translateX, y: translateY, maxX };
}

function getPlaceCircles(
  changeSelected: Props["changeSelected"],
  updateHover: React.Dispatch<string | undefined>,
  directoryColors: Props["directoryColors"]
) {
  const getFill = (d: TrimmedDataNode) => {
    return directoryColors[d.directory];
  };

  return {
    placeCircles: (inOrOut: InOut, files: NodeWithPosition[]) => {
      return files
        .sort((a, b) => a.r - b.r)
        .map(d => {
          return (
            <g
              key={d.id}
              onClick={() => changeSelected(d.id)}
              onMouseEnter={() => updateHover(d.id)}
              onMouseLeave={() => updateHover(undefined)}
            >
              <g transform={`translate(${d.x}, ${d.y})`}>
                <circle r={d.r} fill={getFill(d)} stroke="white" />
                {d.r > 8 && (
                  <text
                    y=".4em"
                    fontSize="12"
                    textAnchor={(inOrOut === "in" && "end") || "start"}
                  >
                    {d.fileName}
                  </text>
                )}
              </g>
            </g>
          );
        });
    },
    getFill
  };
}

export default function RippleChart(props: Props) {
  const {
    edges,
    nodes,
    max,
    selected,
    directories,
    directoryColors,
    changeSelected
  } = props;

  const [hover, updateHover] = useState<string>();
  const selectedNode = nodes.find(d => d.id === selected);
  const { placeCircles, getFill } = useMemo(
    () => getPlaceCircles(changeSelected, updateHover, directoryColors),
    [changeSelected, updateHover, directoryColors]
  );

  if (!selectedNode || !max) return null;

  let requires = {
      nodesWithPosition: [] as NodeWithPosition[],
      x: 0,
      y: 0,
      maxX: 0
    },
    requiredBy = {
      nodesWithPosition: [] as NodeWithPosition[],
      x: 0,
      y: 0,
      maxX: 0
    },
    nextLevelNodes: NodeWithPosition[] = [],
    nextLevelEdges: Edge[] = [];

  const count = selectedNode.count;

  const radiusScale = scaleSqrt()
    .domain([0, max])
    .range([0, 20]);

  let usedNodes: { [key: string]: NodeWithPosition } = {};
  let selectedXPos = 0;
  let selectedYPos = 0;
  let maxXPos = 0;
  if (count) {
    requires = mapLocation(
      radiusScale,
      "in",
      nodes.filter(d => count.requires.indexOf(d.id) !== -1)
    );
    requiredBy = mapLocation(
      radiusScale,
      "out",
      nodes.filter(d => count.requiredBy.indexOf(d.id) !== -1)
    );

    nextLevelEdges = [
      ...count.requires.map(d => ({ source: d, target: selected })),
      ...count.requiredBy.map(d => ({ target: d, source: selected }))
    ];

    usedNodes = [
      ...requires.nodesWithPosition,
      ...requiredBy.nodesWithPosition
    ].reduce((p: { [key: string]: NodeWithPosition }, c: NodeWithPosition) => {
      p[c.id] = c;
      return p;
    }, {});

    selectedXPos = Math.max(requires.x, requiredBy.x);
    selectedYPos = Math.max(requires.y, requiredBy.y);
    maxXPos = Math.max(requires.maxX, requiredBy.maxX);

    const getNextLevel = (requiredByKeys: string[], level = 0) => {
      const edgeLevel = edges.filter(
        d => requiredByKeys.indexOf(d.source) !== -1
      );
      nextLevelEdges.push(...edgeLevel);

      const edgeLevelKeys = edgeLevel.map(d => d.target);

      const matchingNodes = nodes.filter(
        d => edgeLevelKeys.indexOf(d.id) !== -1 && !usedNodes[d.id]
      );

      if (matchingNodes.length > 0) {
        const newNodes = mapLocation(
          radiusScale,
          "out",
          matchingNodes,
          OFFSET * (level + 2)
        );

        newNodes.nodesWithPosition.forEach(n => {
          usedNodes[n.id] = n;
          nextLevelNodes.push(n);
        });

        selectedXPos = Math.max(selectedXPos, newNodes.x);
        selectedYPos = Math.max(selectedYPos, newNodes.y);
        maxXPos = Math.max(maxXPos, newNodes.maxX);

        getNextLevel(
          newNodes.nodesWithPosition.map(d => d.id),
          level + 1
        );
      }
    };

    getNextLevel(count.requiredBy);

    if (requires.nodesWithPosition.length === 0) {
      selectedXPos = 150;
    } else {
      selectedXPos += 150;
    }
  }

  const primaryRadius = radiusScale(selectedNode.totalBytes);

  let showEdges: Edge[] = [];
  let showNodes: { id: string; anchor: string }[] = [];
  if (hover) {
    showEdges = nextLevelEdges.filter(
      d => d.source === hover || d.target === hover
    );

    showNodes = Object.values(
      showEdges.reduce(
        (
          p: {
            [key: string]: {
              id: string;
              anchor: string;
            };
          },
          c
        ) => {
          p[c.source] = {
            id: c.source,
            anchor: c.target === selected ? "end" : "start"
          };
          p[c.target] = { id: c.target, anchor: "start" };
          return p;
        },
        {}
      )
    );
  }

  return (
    <div className="padding">
      <div className="flex baseline">
        <h2>{selected} </h2>
        <div className="margin-left">
          <button
            className="alert"
            onClick={() => {
              changeSelected(undefined);
            }}
          >
            x Zoom out to treemap
          </button>
        </div>
      </div>
      <img className="icon" alt="details" src="/img/ripple.png" />
      <b>Ripple Chart </b>
      <br />
      <p>
        A detailed look at how a <span className="primary">resource</span> is
        linked to an entry point of your application.{" "}
        <span className="primary">Resources</span> with many required bys are
        harder to remove as a dependency.
      </p>
      <p>
        {directories.map((d, i) => (
          <span key={i} className="padding-right inline-block">
            <svg
              className="overflow-visible"
              width="30"
              height="1.2em"
              viewBox="0 -1.5 10 10"
            >
              <circle r="5" cx="5" cy="5" fill={directoryColors[d]} />
            </svg>
            {d}{" "}
          </span>
        ))}
      </p>
      <div style={{ overflowY: "auto", overflowX: "auto", maxHeight: "80vh" }}>
        <svg
          width={selectedXPos + maxXPos + 200}
          height={selectedYPos * 2 + 60}
          className="overflow-visible"
          style={{ border: `1px solid black` }}
        >
          <g transform={`translate(${selectedXPos},${selectedYPos + 30})`}>
            <circle
              r={primaryRadius}
              stroke={primary}
              strokeWidth={2}
              fill={getFill(selectedNode)}
            />
            {placeCircles("in", requires.nodesWithPosition)}
            {placeCircles("out", requiredBy.nodesWithPosition)}
            {placeCircles("out", nextLevelNodes)}
            {requiredBy.nodesWithPosition.length !== 0 && (
              <g transform={`translate(${primaryRadius} , 0)`}>
                <line stroke={primary} x2={100} />
                <text fontSize="11" fontWeight="bold" x={5} y={-3}>
                  Required by
                </text>
                <text fontSize="11" fontWeight="bold" x={5} y={14}>
                  {count.transitiveRequiredBy.length} files
                </text>
              </g>
            )}
            {requires.nodesWithPosition.length !== 0 && (
              <g transform={`translate(${-primaryRadius} , 0)`}>
                <line stroke={primary} x2={-100} />{" "}
                <text
                  textAnchor="end"
                  fontSize="11"
                  fontWeight="bold"
                  x={-8}
                  y={-3}
                >
                  Requires
                </text>
                <text
                  fontSize="11"
                  textAnchor="end"
                  fontWeight="bold"
                  x={-8}
                  y={14}
                >
                  {count.requires.length} files/modules
                </text>
              </g>
            )}

            <g
              transform={`translate(0, ${-primaryRadius -
                14 -
                14 * selected.split("/").length})`}
            >
              <text x={-200} fill={primary} textAnchor="middle">
                {selected.split("/").map((d, i, array) => {
                  return (
                    <tspan key={i} x={0} dy={"1em"}>
                      {d}
                      {i !== array.length - 1 && "/"}
                    </tspan>
                  );
                })}
              </text>
            </g>
            <rect
              x={-selectedXPos}
              y={-selectedYPos - 30}
              width="100%"
              height="100%"
              fill="white"
              className={`opacity-filter ${(hover && "on") || "off"}`}
              pointerEvents="none"
            />

            {hover &&
              showEdges.map((d, i) => {
                const source = usedNodes[d.source];
                const target = usedNodes[d.target];

                const middle = {
                  x: source.x + ((target.x - source.x) * 2) / 3,
                  y: source.y + ((target.y - source.y) * 2) / 3
                };

                const a = arrow({
                  start: [source.x, source.y],
                  end: [middle.x, middle.y],
                  scale: 1.5
                });

                const color =
                  d.source === hover
                    ? "rgba(62, 156, 254,.5)"
                    : "rgba(232, 212, 26, .5)";

                return (
                  <g pointerEvents="none" key={i}>
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={color}
                    />
                    <circle
                      r={source.r}
                      cx={source.x}
                      cy={source.y}
                      stroke={color}
                      fill={"none"}
                    />
                    <path
                      d={a.components[0].attrs.d}
                      fill={color}
                      stroke={color}
                    />
                    <circle
                      r={target.r}
                      cx={target.x}
                      cy={target.y}
                      stroke={color}
                      fill={"none"}
                    />
                  </g>
                );
              })}
            {hover &&
              showNodes.map((d, i) => {
                const n = usedNodes[d.id];
                return (
                  <g
                    transform={`translate(${n.x},${n.y})`}
                    pointerEvents="none"
                    key={i}
                  >
                    <text y=".4em" fontSize="12" textAnchor={d.anchor}>
                      {n.fileName}
                    </text>
                  </g>
                );
              })}
          </g>
        </svg>
      </div>
    </div>
  );
}