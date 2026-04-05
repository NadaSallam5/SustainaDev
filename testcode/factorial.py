def find_duplicates(nums):
    duplicates = set()

    for num in nums:
        if num in duplicates:
            return [num]
        else:
            duplicates.add(num)

    return []