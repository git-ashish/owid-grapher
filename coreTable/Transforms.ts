import {
    computeRollingAverage,
    insertMissingValuePlaceholders,
} from "explorer/covidExplorer/CovidExplorerUtils"
import { flatten } from "grapher/utils/Util"
import {
    ColumnSlug,
    CoreColumnDef,
    CoreColumnStore,
    Time,
} from "./CoreTableConstants"
import { InvalidCell, InvalidCellTypes, isValid } from "./InvalidCells"

// Assumptions: data is sorted by entity, then time
// todo: move tests over from CE
const timeSinceEntityExceededThreshold = (
    columnStore: CoreColumnStore,
    timeSlug: ColumnSlug,
    entitySlug: ColumnSlug,
    columnSlug: ColumnSlug,
    thresholdAsString: string
) => {
    const threshold = parseFloat(thresholdAsString)
    const groupValues = columnStore[entitySlug] as string[]
    const columnValues = columnStore[columnSlug] as number[]
    const timeValues = columnStore[timeSlug] as number[]
    let currentGroup: string
    let groupExceededThresholdAtTime: number
    return columnValues.map((value, index) => {
        const group = groupValues[index]
        if (group !== currentGroup) {
            if (!isValid(value)) return value
            if (value < threshold) return InvalidCellTypes.ValueTooLow

            currentGroup = group
            groupExceededThresholdAtTime = timeValues[index]
        }
        return groupExceededThresholdAtTime
    })
}

// Assumptions: data is sorted by entity, then time
// todo: move tests over from CE
const rollingAverage = (
    columnStore: CoreColumnStore,
    timeSlug: ColumnSlug,
    entitySlug: ColumnSlug,
    columnSlug: ColumnSlug,
    windowSize: number
) => {
    const groupValues = columnStore[entitySlug] as string[]
    const columnValues = columnStore[columnSlug] as number[]
    const timeValues = columnStore[timeSlug] as number[]
    const groups: (number | InvalidCell)[][] = []
    const len = groupValues.length
    if (!len) return []
    let currentGroup = groupValues[0]
    let currentValues: number[] = []
    let currentTimes: Time[] = []

    for (let rowIndex = 0; rowIndex <= len; rowIndex++) {
        const groupName = groupValues[rowIndex]
        const value = columnValues[rowIndex]
        const time = timeValues[rowIndex]
        if (currentGroup !== groupName) {
            const averages = computeRollingAverage(
                insertMissingValuePlaceholders(currentValues, currentTimes),
                windowSize
            ).filter((value) => !(value instanceof InvalidCell))
            groups.push(averages)
            if (value === undefined) break // We iterate to <= so that we push the last row
            currentValues = []
            currentTimes = []
            currentGroup = groupName
        }
        currentValues.push(value)
        currentTimes.push(time)
    }
    return flatten(groups)
}

const divideBy = (
    columnStore: CoreColumnStore,
    numeratorSlug: ColumnSlug,
    denominatorSlug: ColumnSlug
) => {
    const numeratorValues = columnStore[numeratorSlug] as number[]
    const denominatorValues = columnStore[denominatorSlug] as number[]
    return denominatorValues.map((denominator, index) => {
        if (denominator === 0) return InvalidCellTypes.DivideByZeroError
        const numerator = numeratorValues[index]
        if (!isValid(numerator)) return numerator
        if (!isValid(denominator)) return denominator
        return numerator / denominator
    })
}

// Assumptions: data is sorted by entity, then time, and time is a continous integer with a row for each time step.
// todo: move tests over from CE
const percentChange = (
    columnStore: CoreColumnStore,
    timeSlug: ColumnSlug,
    entitySlug: ColumnSlug,
    columnSlug: ColumnSlug,
    windowSize: number
) => {
    const groupValues = columnStore[entitySlug] as string[]
    const columnValues = columnStore[columnSlug] as number[]

    let currentEntity: string
    return columnValues.map((value: any, index) => {
        if (!currentEntity) currentEntity = groupValues[index]
        const previousValue = columnValues[index! - windowSize] as any
        if (currentEntity !== groupValues[index]) {
            currentEntity = groupValues[index]
            return InvalidCellTypes.NoValueToCompareAgainst
        }
        if (previousValue instanceof InvalidCell) return previousValue
        if (value instanceof InvalidCell) return value

        if (previousValue === 0) return InvalidCellTypes.DivideByZeroError

        if (previousValue === undefined)
            return InvalidCellTypes.NoValueToCompareAgainst

        return (100 * (value - previousValue)) / previousValue
    })
}

// Todo: remove?
const asPercentageOf = (
    columnStore: CoreColumnStore,
    numeratorSlug: ColumnSlug,
    denominatorSlug: ColumnSlug
) =>
    divideBy(columnStore, numeratorSlug, denominatorSlug).map((num) =>
        typeof num === "number" ? 100 * num : num
    )

const availableTransforms: any = {
    asPercentageOf: asPercentageOf,
    timeSinceEntityExceededThreshold: timeSinceEntityExceededThreshold,
    divideBy: divideBy,
    rollingAverage: rollingAverage,
    percentChange: percentChange,
} as const

export const AvailableTransforms = Object.keys(availableTransforms)

export const applyTransforms = (
    columnStore: CoreColumnStore,
    defs: CoreColumnDef[]
) => {
    const orderedDefs = defs.filter((def) => def.transform) // todo: sort by graph dependency order
    orderedDefs.forEach((def) => {
        const words = def.transform!.split(" ")
        const transformName = words.find(
            (word) => availableTransforms[word] !== undefined
        )
        if (!transformName) {
            console.log(`Warning: transform '${transformName}' not found`)
            return
        }
        const params = words.filter((word) => word !== transformName)
        try {
            columnStore[def.slug] = availableTransforms[transformName](
                columnStore,
                ...params
            )
        } catch (err) {
            console.log(err)
            console.log(`Error performing transform ${def.transform}`)
        }
    })
    return columnStore
}
