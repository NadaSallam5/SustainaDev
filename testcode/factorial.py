def find_duplicates(nums):
    duplicates = set()

    for num in nums:
        if nums.count(num) > 1 and num not in duplicates:
            duplicates.add(num)

    return list(duplicates)