def find_discrepancies(warehouse, records):
    result = []
    for item in warehouse:
        for record in records:
            if item == record:
                result.append(item)
    return result